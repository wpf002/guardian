import { createHash } from "node:crypto";

/**
 * MinHash + LSH over the sextortion script corpus (DESIGN.md 5, 11).
 *
 * Financial sextortion is templated: 38% of threats reuse "ruin your life"
 * verbatim and crews paste whole scripts. Exact phrase matching misses a
 * one-word edit, and an encoder is overkill for near-duplicate text, so this
 * estimates Jaccard similarity over character shingles and gates candidates
 * through banded LSH.
 */

/**
 * Universal hashing over a 31-bit field. Coefficients are kept under 2^20 so
 * a * h stays below 2^53 and the arithmetic is exact in a double, which is what
 * lets the Python service in services/ml produce identical signatures without
 * either side reaching for big integers.
 */
const PRIME = 2147483647; // 2^31 - 1
const COEFF_MASK = (1 << 20) - 1;
const MAX_HASH = PRIME;

export interface MinHashOptions {
  /** Number of permutations. 128 is the usual accuracy/cost point. */
  numPerm?: number;
  /** Character shingle width. 5 survives single-word edits. */
  shingleSize?: number;
  /** LSH bands. bands * rows must equal numPerm. */
  bands?: number;
}

export interface ScriptEntry {
  id: string;
  label: string;
  text: string;
  signature: number[];
}

export interface ScriptMatch {
  id: string;
  label: string;
  /** Estimated Jaccard similarity in [0, 1]. */
  similarity: number;
}

function shingles(text: string, size: number): Set<string> {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const out = new Set<string>();
  if (cleaned.length === 0) return out;
  if (cleaned.length <= size) {
    out.add(cleaned);
    return out;
  }
  for (let i = 0; i + size <= cleaned.length; i++) {
    out.add(cleaned.slice(i, i + size));
  }
  return out;
}

/**
 * FNV-1a over UTF-8 bytes. A pure integer loop that costs nothing to call and
 * that services/ml reproduces byte for byte. sha1 through the native crypto
 * binding was the dominant cost of a query.
 */
function shingleHash(shingle: string): number {
  let h = 0x811c9dc5;
  for (const byte of Buffer.from(shingle, "utf8")) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % PRIME;
}

/** Deterministic permutation coefficients, so signatures are portable across processes. */
function permutations(numPerm: number): Array<{ a: number; b: number }> {
  const out: Array<{ a: number; b: number }> = [];
  for (let i = 0; i < numPerm; i++) {
    const digest = createHash("sha256").update(`guardian-minhash-${i}`).digest();
    const a = (digest.readUInt32BE(0) & COEFF_MASK) + 1;
    const b = digest.readUInt32BE(4) & COEFF_MASK;
    out.push({ a, b });
  }
  return out;
}

export class ScriptIndex {
  readonly numPerm: number;
  readonly shingleSize: number;
  readonly bands: number;
  readonly rows: number;

  private readonly perms: Array<{ a: number; b: number }>;
  private readonly entries = new Map<string, ScriptEntry>();
  private readonly buckets = new Map<string, Set<string>>();

  constructor(opts: MinHashOptions = {}) {
    this.numPerm = opts.numPerm ?? 128;
    this.shingleSize = opts.shingleSize ?? 5;
    this.bands = opts.bands ?? 32;
    if (this.numPerm % this.bands !== 0) {
      throw new Error("numPerm must be divisible by bands");
    }
    this.rows = this.numPerm / this.bands;
    this.perms = permutations(this.numPerm);
  }

  signature(text: string): number[] {
    const grams = shingles(text, this.shingleSize);
    const sig = new Array<number>(this.numPerm).fill(MAX_HASH);
    if (grams.size === 0) return sig;

    const perms = this.perms;
    const n = this.numPerm;
    for (const gram of grams) {
      const h = shingleHash(gram);
      for (let i = 0; i < n; i++) {
        const p = perms[i]!;
        const value = (p.a * h + p.b) % PRIME;
        if (value < sig[i]!) sig[i] = value;
      }
    }
    return sig;
  }

  add(id: string, label: string, text: string): void {
    const signature = this.signature(text);
    this.entries.set(id, { id, label, text, signature });
    for (const key of this.bandKeys(signature)) {
      let bucket = this.buckets.get(key);
      if (!bucket) {
        bucket = new Set();
        this.buckets.set(key, bucket);
      }
      bucket.add(id);
    }
  }

  size(): number {
    return this.entries.size;
  }

  private bandKeys(signature: number[]): string[] {
    const keys: string[] = [];
    for (let band = 0; band < this.bands; band++) {
      const slice = signature.slice(band * this.rows, (band + 1) * this.rows);
      // A plain join is a fine map key; nothing about it needs to be a digest.
      keys.push(`${band}:${slice.join(",")}`);
    }
    return keys;
  }

  /** Best match above `threshold`, or null. LSH narrows the comparison set first. */
  query(text: string, threshold = 0.5): ScriptMatch | null {
    const signature = this.signature(text);
    const candidates = new Set<string>();
    for (const key of this.bandKeys(signature)) {
      for (const id of this.buckets.get(key) ?? []) candidates.add(id);
    }

    let best: ScriptMatch | null = null;
    for (const id of candidates) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      const similarity = jaccard(signature, entry.signature);
      if (similarity >= threshold && (best === null || similarity > best.similarity)) {
        best = { id: entry.id, label: entry.label, similarity };
      }
    }
    return best;
  }

  /** Exhaustive scan. Used by the eval harness to measure what LSH is missing. */
  queryExact(text: string, threshold = 0.5): ScriptMatch | null {
    const signature = this.signature(text);
    let best: ScriptMatch | null = null;
    for (const entry of this.entries.values()) {
      const similarity = jaccard(signature, entry.signature);
      if (similarity >= threshold && (best === null || similarity > best.similarity)) {
        best = { id: entry.id, label: entry.label, similarity };
      }
    }
    return best;
  }
}

export function jaccard(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("signature length mismatch");
  let same = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
  return same / a.length;
}
