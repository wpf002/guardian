import { request as httpsRequest, type RequestOptions } from "node:https";
import type { LookupAddress } from "node:dns";
import { isPrivateAddress } from "@guardian/schema/webhook-target";

/**
 * A request that connects to an address that was already checked.
 *
 * checkWebhookTarget resolves the endpoint's name and refuses any answer inside
 * a private range. Between that check and the connection the operating system
 * resolves the name again, and a name whose answer changes in that window is
 * how a checked endpoint still reaches Guardian's own network. Rechecking
 * immediately before the request narrows the window; it does not close it,
 * because the recheck and the connect are two resolutions.
 *
 * This closes it. The addresses the check passed on are pinned into the socket
 * through the `lookup` option, so the connection goes to an address that was
 * inspected. TLS still verifies the certificate against the hostname, and the
 * Host header is still the hostname, so pinning changes where the packets go
 * and nothing about who the endpoint has to prove it is.
 *
 * Built on node:https rather than a dispatcher, because fetch has no supported
 * way to pin one and this needs no third-party code on the path that carries a
 * signed tier out of the deployment.
 */

/** What the attempt path reads off a response. Nothing reads a body. */
export interface PinnedResponse {
  status: number;
  headers: Record<string, string>;
}

export interface PinnedRequestInit {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export class PinnedTargetError extends Error {
  constructor(readonly code: "no_addresses" | "private_address") {
    super(
      code === "no_addresses"
        ? "No checked address to connect to."
        : "The checked address is in a private range.",
    );
    this.name = "PinnedTargetError";
  }
}

/**
 * Send one request to one of `addresses`, with `url`'s hostname used for TLS
 * and for the Host header.
 *
 * The addresses are re-checked here even though the caller checked them. It is
 * two lines, it is the last point before a socket opens, and a caller that
 * passes an unchecked list should fail rather than be trusted.
 */
export function pinnedRequest(
  url: string,
  addresses: readonly string[],
  init: PinnedRequestInit,
): Promise<PinnedResponse> {
  if (addresses.length === 0) return Promise.reject(new PinnedTargetError("no_addresses"));
  for (const address of addresses) {
    if (isPrivateAddress(address)) return Promise.reject(new PinnedTargetError("private_address"));
  }

  const parsed = new URL(url);
  const pinned = addresses[0]!;
  const family = pinned.includes(":") ? 6 : 4;

  const options: RequestOptions = {
    method: init.method,
    hostname: parsed.hostname,
    port: parsed.port === "" ? 443 : Number(parsed.port),
    path: `${parsed.pathname}${parsed.search}`,
    headers: init.headers,
    // TLS is still verified against the name. Pinning decides where the
    // connection goes, never who is allowed to answer it.
    servername: parsed.hostname,
    lookup: (_hostname, _opts, callback) => {
      // Signature covers both of node's lookup callback shapes.
      const cb = callback as unknown as (
        err: NodeJS.ErrnoException | null,
        address: string | LookupAddress[],
        family?: number,
      ) => void;
      cb(null, pinned, family);
    },
  };

  return new Promise<PinnedResponse>((resolve, reject) => {
    const req = httpsRequest(options, (res) => {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(res.headers)) {
        if (typeof value === "string") headers[key] = value;
        else if (Array.isArray(value) && value[0] !== undefined) headers[key] = value[0];
      }
      // Nothing here reads a body, and a body left unread holds the socket
      // open until the agent times it out.
      res.resume();
      resolve({ status: res.statusCode ?? 0, headers });
    });

    req.on("error", reject);
    if (init.signal) {
      if (init.signal.aborted) {
        req.destroy(new Error("aborted"));
      } else {
        init.signal.addEventListener("abort", () => req.destroy(new Error("aborted")), {
          once: true,
        });
      }
    }
    req.end(init.body);
  });
}
