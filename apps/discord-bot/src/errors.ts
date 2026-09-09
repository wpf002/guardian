/**
 * Error class and driver code only. A message can quote a row or name an
 * account, and this string reaches process logs and the audit chain.
 *
 * Its own module because both bot.ts and pipeline.ts need it and bot.ts imports
 * pipeline.ts. Leaving it in bot.ts would have made that a cycle.
 */
export function describeError(err: unknown): string {
  if (typeof err !== "object" || err === null) return typeof err;
  const name = (err as { name?: unknown }).name;
  const code = (err as { code?: unknown }).code;
  const base = typeof name === "string" && name.length > 0 ? name : "Error";
  return typeof code === "string" || typeof code === "number" ? `${base} ${code}` : base;
}
