/**
 * One reporting path (CLAUDE.md rule 4), and the owner files it themselves.
 *
 * The constant sits in its own module because the report draft builder next
 * door reads band labels from the fixtures, which load the audit chain and the
 * schema barrel, and the barrel reads the lexicon off disk at import. The
 * client button only needs the address, so it takes it from here and the
 * builder stays on the server. draft.ts re-exports it, so nothing that already
 * imports it has to move.
 */

export const CYBERTIPLINE_URL = "https://report.cybertip.org";
