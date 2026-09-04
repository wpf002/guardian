/**
 * Rule 1 is 18 USC 2252/2252A. There is no detection or research exception, so
 * no code path may accept, store, download, fetch, or log image or video bytes.
 * The edge drops any request carrying them and records a customer-side
 * violation (CLAUDE.md rule 1, DESIGN.md 2).
 *
 * This runs before schema validation, because a payload that carries bytes must
 * be refused whether or not it is otherwise well formed, and the bytes must
 * never reach a logger.
 */

import { MEDIA_BASE64_RUN, MEDIA_DATA_URI, MEDIA_DATA_URI_EMBEDDED } from "@guardian/schema";

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
  "application/octet-stream",
];

/**
 * The two byte-shaped patterns live in @guardian/schema so the edge and every
 * other surface that takes free text (the report builder, the reviewer console)
 * scan for the same thing. The media-URL pattern stays here: it is about a
 * customer asking Guardian to fetch a file, which only happens at the edge.
 */
const DATA_URI = MEDIA_DATA_URI;
const BASE64_BLOB = MEDIA_BASE64_RUN;
const MEDIA_URL = /https?:\/\/\S+\.(jpe?g|png|gif|webp|bmp|heic|mp4|mov|webm|avi|mkv)(\?|#|$)/i;

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
      if (BASE64_BLOB.test(node)) {
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
