/**
 * Media bytes hiding in free text.
 *
 * Rule 1 is 18 USC 2252/2252A: no code path may accept, store, download, fetch
 * or log media bytes. `apps/ingest/src/media-guard.ts` enforces that on
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

/**
 * A data URI carrying a base64 payload, anchored, for a field whose whole value
 * is the URI.
 *
 * The media type is deliberately NOT matched. It used to be an alternation over
 * image, video, audio and application/octet-stream, which is a blocklist, and a
 * blocklist over an attacker-chosen label is not a control: `data:font/woff2`
 * and `data:model/gltf-binary` carry bytes exactly as well as `data:image/png`
 * does, and the sender picks the label. So the rule is now the shape rather
 * than the claim. Anything declaring base64 and carrying a payload is bytes,
 * whatever it calls itself.
 *
 * Parameters before the marker are allowed, because `;charset=utf-8;base64,`
 * is legal and used to walk straight past this.
 */
const DATA_URI_BODY = String.raw`data:[\w.+-]+\/[\w.+-]+(?:;[\w.+-]+=[^;,\s]*)*;base64,[A-Za-z0-9+/_-]{32,}`;

/**
 * Anchored, for a field whose entire value is the URI. No payload length and no
 * base64 marker required: `data:image/png,%89PNG...` is percent-encoded bytes
 * with no base64 anywhere, and a short payload is still a payload. A field whose
 * whole value is a data URI is not a field Guardian has any use for, so the
 * shape alone is enough here and the embedded variant below carries the
 * stricter test that free text needs.
 */
export const MEDIA_DATA_URI = /^data:[\w.+-]*\/?[\w.+-]*[;,]/i;

/**
 * The same thing partway through a longer string, which is what a pasted URI
 * inside a sentence looks like. It requires the base64 marker and a payload
 * behind it: prose can mention a data URI, and nothing a person writes by hand
 * carries thirty-two characters of base64 after one.
 */
export const MEDIA_DATA_URI_EMBEDDED = new RegExp(DATA_URI_BODY, "i");

/**
 * A long run of base64 characters is a payload, whatever field it is hiding in.
 *
 * The class covers base64url as well as standard base64. It has to: base64url
 * substitutes `-` for `+` and `_` for `/`, both of which appear about once in
 * sixteen characters of arbitrary binary, so under the old `[A-Za-z0-9+/]` the
 * longest unbroken run in a base64url-encoded image was around 160 characters
 * against a 512 threshold. A whole JPEG went through the edge and into Postgres
 * with a 202.
 *
 * Exported for callers that want the raw pattern. Prefer `carriesBase64Payload`,
 * which collapses separators first.
 */
export const MEDIA_BASE64_RUN = /[A-Za-z0-9+/_-]{512,}={0,2}/;

/** How long a collapsed run has to be before it is treated as a payload. */
export const BASE64_RUN_THRESHOLD = 512;

/**
 * Separators that break a run without changing what it decodes to.
 *
 * `base64` on macOS and Linux wraps at 76 columns by default, and a newline
 * every 76 characters took the longest unbroken run below any threshold worth
 * setting. The same trick works with a space, a CRLF, or a period every sixty
 * characters, and the receiving end strips them before decoding. So the run
 * test collapses them first and measures what a decoder would actually see.
 */
const BASE64_SEPARATORS = /[\s.\-_]+/g;

/**
 * True when the string carries a base64 payload, separators or no separators.
 *
 * Two conditions, and both are needed. The collapsed run has to be long enough
 * to be a payload rather than a token, and the region has to be dense in base64
 * characters, which is what keeps a long stretch of ordinary punctuation-light
 * prose out. Collapsing alone would fire on a paragraph; density alone would
 * fire on a short hash.
 */
export function carriesBase64Payload(value: string): boolean {
  if (value.length < BASE64_RUN_THRESHOLD) return false;
  if (MEDIA_BASE64_RUN.test(value)) return true;

  // Collapse the separators a decoder would ignore, then look again. `-` and
  // `_` are both separators here and base64url characters, so the collapsed
  // form is tested against the standard class: a base64url payload broken up
  // with dashes collapses into an unbroken standard-class run either way.
  const collapsed = value.replace(BASE64_SEPARATORS, "");
  if (collapsed.length < BASE64_RUN_THRESHOLD) return false;
  const run = /[A-Za-z0-9+/]{512,}={0,2}/.exec(collapsed);
  if (!run) return false;

  // Density over the original region, so a document that happens to concatenate
  // many short alphanumeric tokens is not read as a payload. A real encoding is
  // almost entirely in-class before collapsing; prose is not.
  const inClass = (value.match(/[A-Za-z0-9+/_=-]/g) ?? []).length;
  return inClass / value.length > 0.9;
}

/** True when the string looks like it is carrying media bytes. */
export function looksLikeMediaBytes(value: string): boolean {
  const trimmed = value.trim();
  return (
    MEDIA_DATA_URI.test(trimmed) ||
    MEDIA_DATA_URI_EMBEDDED.test(value) ||
    carriesBase64Payload(value)
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
      if (carriesBase64Payload(node)) {
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
    seen.push(node);

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
