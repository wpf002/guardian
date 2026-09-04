/**
 * Media bytes hiding in free text.
 *
 * Rule 1 is 18 USC 2252/2252A: no code path may accept, store, download, fetch
 * or log image or video bytes. `apps/ingest/src/media-guard.ts` enforces that on
 * customer-submitted events at the edge, but the edge is not the only way a
 * string enters Guardian. A reviewer types notes into the console, and those
 * notes travel into the CyberTipline filing. Nothing at the edge ever sees them.
 *
 * So the two byte-shaped patterns live here, in the package both the edge and
 * the report builder already depend on, and every surface that accepts free text
 * a person wrote runs the same scan over it.
 *
 * This throws rather than stripping, for the same reason `assertNoMessageText`
 * does: a silent rewrite hides the fact that some path is carrying bytes.
 */

/** A data URI carrying media. The prefix is enough; the payload is never read. */
export const MEDIA_DATA_URI = /^data:(image|video|application\/octet-stream)/i;

/**
 * The same thing partway through a longer string, which is what a pasted URI
 * inside a sentence looks like. Anchoring is right for a field whose whole
 * value is the URI and wrong for free text, so this one requires the base64
 * marker and a payload behind it: prose can mention a data URI, and nothing a
 * person writes by hand carries thirty-two characters of base64 after it.
 */
export const MEDIA_DATA_URI_EMBEDDED =
  /data:(image|video|application\/octet-stream)\/?[\w.+-]*;base64,[A-Za-z0-9+/]{32,}/i;

/** A long run of base64 characters is a payload, whatever field it is hiding in. */
export const MEDIA_BASE64_RUN = /[A-Za-z0-9+/]{512,}={0,2}/;

/** True when the string looks like it is carrying media bytes. */
export function looksLikeMediaBytes(value: string): boolean {
  const trimmed = value.trim();
  return (
    MEDIA_DATA_URI.test(trimmed) ||
    MEDIA_DATA_URI_EMBEDDED.test(value) ||
    MEDIA_BASE64_RUN.test(value)
  );
}

export interface MediaTextFinding {
  /** Dotted path to the offending string. Never the string itself. */
  at: string;
  reason: "data_uri" | "base64_run";
  detail: string;
}

/**
 * Every media-shaped string in the value, as dotted paths. Empty is clean.
 *
 * The walk holds live references rather than identity numbers, so two sibling
 * objects can never alias each other and skip a subtree unscanned. Depth is
 * bounded because a report envelope is not deep and an unbounded walk over a
 * caller-supplied structure is its own problem.
 */
export function findMediaBytesInText(value: unknown, maxDepth = 12): MediaTextFinding[] {
  const out: MediaTextFinding[] = [];
  const seen: object[] = [];

  const walk = (node: unknown, path: string, depth: number): void => {
    if (depth > maxDepth || out.length >= 20) return;

    if (typeof node === "string") {
      if (MEDIA_DATA_URI.test(node.trim()) || MEDIA_DATA_URI_EMBEDDED.test(node)) {
        out.push({ at: path, reason: "data_uri", detail: "carries a data URI holding media" });
        return;
      }
      if (MEDIA_BASE64_RUN.test(node)) {
        out.push({
          at: path,
          reason: "base64_run",
          detail: `carries a ${node.length} character run of base64 characters`,
        });
      }
      return;
    }

    if (node === null || typeof node !== "object") return;
    if (seen.some((s) => s === node)) return;
    seen.push(node as object);

    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${path}[${i}]`, depth + 1));
      return;
    }

    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      walk(child, path === "" ? key : `${path}.${key}`, depth + 1);
    }
  };

  walk(value, "", 0);
  return out;
}

/** True when any string anywhere in the value looks like media bytes. */
export function hasMediaBytesInText(value: unknown): boolean {
  return findMediaBytesInText(value).length > 0;
}

/**
 * Throws rather than stripping. `where` names the caller and the message names
 * the path, so a reviewer is told which field to fix rather than that something
 * somewhere was refused.
 */
export function assertNoMediaBytesInText(value: unknown, where: string): void {
  const found = findMediaBytesInText(value);
  if (found.length === 0) return;
  const first = found[0]!;
  throw new MediaBytesInText(
    `${where}: ${first.at || "the value"} ${first.detail}. Guardian holds a sha256 and the operator's own scanner verdict, never bytes (CLAUDE.md rule 1; 18 USC 2252A has no detection exception).`,
    found,
  );
}

/** Thrown by assertNoMediaBytesInText, so a caller can branch on the type. */
export class MediaBytesInText extends Error {
  constructor(
    message: string,
    readonly findings: MediaTextFinding[],
  ) {
    super(message);
    this.name = "MediaBytesInText";
  }
}
