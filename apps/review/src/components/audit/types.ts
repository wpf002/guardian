/**
 * What the two chain actions hand back to the view.
 *
 * These live next to the components rather than in the action module so a
 * client component can name them without importing anything that runs on the
 * server.
 */

/**
 * The widest span one verification or one export may cover. It lives here
 * rather than in the action module because a "use server" file may only export
 * async functions, and both the form and the server need this number.
 */
export const MAX_RANGE = 500;

export interface VerifyOutcome {
  ok: boolean;
  /** The range that was walked, after clamping. */
  fromSeq: number;
  toSeq: number;
  checked: number;
  /** The entry that broke the chain, when one did. */
  brokenAt?: number;
  /** One plain sentence, already through the wording guard. */
  sentence: string;
}

export interface ExportOutcome {
  filename: string;
  /** The document itself, ready to hand to the browser as a file. */
  json: string;
  entryCount: number;
  verification: VerifyOutcome;
  /** The sequence number this export was recorded under. An export is a write. */
  recordedSeq: number;
  sentence: string;
}
