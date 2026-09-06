/**
 * Rule 1 is 18 USC 2252/2252A. There is no detection or research exception, so
 * no code path may accept, store, download, fetch, or log media bytes. The edge
 * drops any request carrying them and records a customer-side violation
 * (CLAUDE.md rule 1, DESIGN.md 2).
 *
 * Audio counts, and the rule's wording naming image and video did not make it
 * safe to omit. Discord voice messages are audio attachments, a recording of a
 * video call is a media file whatever container it arrives in, and the statute
 * turns on the visual depiction rather than on the MIME type a customer chose.
 * A guard that blocks image/png and passes audio/ogg is a guard that refuses
 * the easy case and accepts the one somebody would actually use to get around
 * it. Refusing audio costs a customer nothing, because Guardian has no audio
 * pipeline to feed and never will (ROADMAP: voice and video are declared a
 * known false negative rather than a roadmap item, because third-party capture
 * of a call Guardian is not party to is interception under rule 3).
 *
 * This runs before schema validation, because a payload that carries bytes must
 * be refused whether or not it is otherwise well formed, and the bytes must
 * never reach a logger.
 */

import { carriesBase64Payload, MEDIA_DATA_URI, MEDIA_DATA_URI_EMBEDDED } from "@guardian/schema";

export interface MediaViolation {
  reason:
    | "binary_content_type"
    | "data_uri"
    | "base64_blob"
    | "byte_field"
    | "media_url"
    | "oversized_body";
  /** Where it was found. Never the content itself. */
  at: string;
  detail: string;
}

/** Field names that only ever exist to carry bytes. */
const BYTE_FIELD_NAMES = [
  "bytes",
  "buffer",
  "blob",
  "imagedata",
  "imagebytes",
  "image_base64",
  "imagebase64",
  "videodata",
  "videobytes",
  "audiodata",
  "audiobytes",
  "voicedata",
  "voicenote",
  "recording",
  "filedata",
  "filecontent",
  "content_base64",
  "contentbase64",
  "attachmentdata",
  "thumbnail",
  "preview",
  "raw",
];

const BINARY_CONTENT_TYPES = [
  "multipart/form-data",
  "image/",
  "video/",
  "audio/",
  "application/octet-stream",
];

/**
 * The two byte-shaped patterns live in @guardian/schema so the edge and every
 * other surface that takes free text (the report builder, the reviewer console)
 * scan for the same thing. The media-URL pattern stays here: it is about a
 * customer asking Guardian to fetch a file, which only happens at the edge.
 */
const DATA_URI = MEDIA_DATA_URI;
/**
 * A link to a file the customer wants Guardian to fetch.
 *
 * The extension has to be followed by a non-URL character rather than by the
 * end of the string. The old anchor was `(\?|#|$)`, which meant "photo.png"
 * inside a sentence was invisible while the same link alone in a field was
 * caught, and a link is almost always inside a sentence. The path class is
 * bounded rather than `\S+` so the match cannot run past the URL into the next
 * word and take its punctuation with it.
 */
const MEDIA_URL =
  /https?:\/\/[^\s<>"']+\.(jpe?g|png|gif|webp|bmp|heic|heif|avif|tiff?|svg|mp4|mov|webm|avi|mkv|m4v|mpe?g|3gp|mp3|wav|ogg|oga|opus|m4a|aac|flac|amr|weba|caf|aiff?|wma|mid|spx)(?![A-Za-z0-9])/i;

export function checkContentType(contentType: string | undefined): MediaViolation | null {
  if (!contentType) return null;
  const lowered = contentType.toLowerCase();
  for (const prefix of BINARY_CONTENT_TYPES) {
    if (lowered.includes(prefix)) {
      return {
        reason: "binary_content_type",
        at: "content-type",
        detail: `content type ${lowered.split(";")[0]} cannot be accepted; send a sha256 hash instead`,
      };
    }
  }
  return null;
}

export function checkBodySize(bytes: number, limit: number): MediaViolation | null {
  if (bytes <= limit) return null;
  return {
    reason: "oversized_body",
    at: "body",
    detail: `body of ${bytes} bytes exceeds the ${limit} byte event limit`,
  };
}

/**
 * Walk the parsed JSON. Returns every violation found so the customer gets one
 * complete answer rather than a game of whack-a-mole, and so the audit entry
 * records the full shape of what was refused.
 */
export function scanForMedia(body: unknown, maxDepth = 8): MediaViolation[] {
  const out: MediaViolation[] = [];
  walk(body, "$", 0);
  return out;

  function walk(node: unknown, path: string, depth: number): void {
    if (depth > maxDepth || out.length >= 20) return;

    if (typeof node === "string") {
      if (DATA_URI.test(node.trim()) || MEDIA_DATA_URI_EMBEDDED.test(node)) {
        out.push({
          reason: "data_uri",
          at: path,
          detail: "field contains a data URI carrying media",
        });
        return;
      }
      // carriesBase64Payload rather than the raw run pattern: it collapses the
      // separators a decoder would ignore before measuring, which is what stops
      // a newline every 76 characters from hiding a whole JPEG, and it covers
      // the base64url alphabet.
      if (carriesBase64Payload(node)) {
        out.push({
          reason: "base64_blob",
          at: path,
          detail: `field contains a ${node.length} character base64 run`,
        });
        return;
      }
      if (MEDIA_URL.test(node)) {
        out.push({
          reason: "media_url",
          at: path,
          detail: "field contains a link to media; Guardian does not fetch media",
        });
      }
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${path}[${i}]`, depth + 1));
      return;
    }

    if (node !== null && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        const normalizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
        if (BYTE_FIELD_NAMES.includes(normalizedKey)) {
          out.push({
            reason: "byte_field",
            at: `${path}.${key}`,
            detail: `field "${key}" is a byte-carrying field name`,
          });
          continue;
        }
        walk(value, `${path}.${key}`, depth + 1);
      }
    }
  }
}

/**
 * A violation is never logged with the offending value. This is what goes into
 * the audit entry and the response.
 */
export function redactViolations(violations: MediaViolation[]): Array<{
  reason: string;
  at: string;
  detail: string;
}> {
  return violations.map((v) => ({ reason: v.reason, at: v.at, detail: v.detail }));
}
