/**
 * The machine name of each event, in words.
 *
 * The column printed score.assigned and review.decision, which name the code
 * that wrote the row rather than the thing that happened. An operator handing
 * this to a lawyer should not have to translate it for them.
 */
export const KIND_WORDS: Record<string, string> = {
  "score.assigned": "Guardian scored a conversation",
  "review.decision": "A reviewer made a decision",
  "evidence.read": "A reviewer read the messages",
  "bundle.exported": "Evidence was downloaded",
  "report.submitted": "A report was sent to NCMEC",
  "retention.deleted": "Data was deleted on schedule",
  "lexicon.updated": "The phrase list changed",
  "customer.violation": "A rule was broken by an incoming request",
  "config.updated": "A setting changed",
  "delivery.result_dropped": "An alert was sent twice",
};
