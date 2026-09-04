/**
 * What a webhook URL is allowed to point at.
 *
 * Guardian's own container issues a request to an address a customer operator
 * chose, twice over: once from the settings page's test-delivery button and once
 * per attempt from the durable delivery worker. Without a check that is a
 * server-side request forgery primitive pointed at Guardian's private network:
 * an operator could sweep internal hosts and ports and read the result back off
 * the button or off the dead-letter view.
 *
 * Three things are checked, and all three are needed:
 *
 *  1. The literal host, so an address typed straight in is refused.
 *  2. Every address the host resolves to, so a public name pointing at private
 *     space is refused.
 *  3. The same check again immediately before the request, so a name that
 *     answers publicly on the save and privately a second later (DNS
 *     rebinding) is refused too.
 *
 * The request itself is sent with redirect: "manual", because a 302 to http://
 * or to a metadata address would otherwise carry the customer's signature
 * headers somewhere the https check never looked.
 *
 * This module lives in packages/schema rather than beside either caller because
 * both need it and check 3 is worth nothing if only one of them runs it. It is
 * a subpath export, not part of the barrel, because it reaches for node:dns.
 */

export interface TargetRefusal {
  ok: false;
  reason: string;
}

export type TargetCheck = { ok: true } | TargetRefusal;

const BLOCKED_HOST_SUFFIXES = [".localhost", ".internal", ".local", ".home.arpa"];
const BLOCKED_HOSTS = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);

const REFUSAL =
  "That host is not reachable from the public internet. A webhook endpoint has to be a public https address, so Guardian will not post to loopback, private, link-local or internal names.";

function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  if (parts.some((part) => part.length === 0 || !/^\d+$/.test(part))) return null;
  return octets;
}

/**
 * True when the string is an IP literal rather than a name. Only a literal is
 * handed to isPrivateAddress from the literal-host check; every address that
 * comes back from a lookup already is one.
 */
export function looksLikeIpLiteral(value: string): boolean {
  const bare = value.replace(/^\[|\]$/g, "");
  return parseIpv4(bare) !== null || bare.includes(":");
}

/**
 * True for anything outside public unicast space, in either address family.
 * A string that is not an address at all reads as private, so the check fails
 * closed if it is ever handed something unexpected.
 */
export function isPrivateAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "").split("%")[0] ?? address;

  const v4 = parseIpv4(bare);
  if (v4) {
    const [a, b] = v4 as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local, and the metadata address
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true; // 192.0.0.0/24 and 192.0.2.0/24
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast and reserved
    return false;
  }

  const v6 = bare.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  if (v6.startsWith("fe80")) return true; // link-local
  if (/^f[cd]/.test(v6)) return true; // unique local
  if (v6.startsWith("::ffff:")) {
    const mapped = v6.slice("::ffff:".length);
    return parseIpv4(mapped) ? isPrivateAddress(mapped) : true;
  }
  return v6.includes(":") ? false : true;
}

/** The literal host, before any lookup. Cheap, and it catches the common case. */
export function checkLiteralHost(hostname: string): TargetCheck {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.length === 0) return { ok: false, reason: REFUSAL };
  if (BLOCKED_HOSTS.has(host)) return { ok: false, reason: REFUSAL };
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return { ok: false, reason: REFUSAL };
  }
  if (!host.includes(".") && !host.includes(":")) {
    // A bare label is a name only something on the same network can resolve.
    return { ok: false, reason: REFUSAL };
  }
  if (looksLikeIpLiteral(host) && isPrivateAddress(host)) {
    return { ok: false, reason: REFUSAL };
  }
  return { ok: true };
}

/**
 * The literal host plus every address it resolves to. Call it on the save and
 * again immediately before the request.
 */
export async function checkWebhookTarget(url: URL): Promise<TargetCheck> {
  if (url.protocol !== "https:") {
    return {
      ok: false,
      reason: "The endpoint has to be https. Tier events are not sent in the clear.",
    };
  }
  const literal = checkLiteralHost(url.hostname);
  if (!literal.ok) return literal;

  let addresses: string[];
  try {
    const { lookup } = await import("node:dns/promises");
    const resolved = await lookup(url.hostname, { all: true });
    addresses = resolved.map((entry) => entry.address);
  } catch {
    return {
      ok: false,
      reason: "That host did not resolve, so Guardian will not store it as an endpoint.",
    };
  }
  if (addresses.length === 0) return { ok: false, reason: REFUSAL };
  if (addresses.some((address) => isPrivateAddress(address))) {
    return { ok: false, reason: REFUSAL };
  }
  return { ok: true };
}
