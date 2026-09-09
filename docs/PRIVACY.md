# Guardian Privacy Policy

**Draft. Not published, and not reviewed by counsel.** Every factual claim below
is checked against the code and cited to the file that enforces it, so a lawyer
reading it can verify rather than take it on trust. The wording is theirs to
change; the facts are not.

Last checked against the code: 2026-09-09.

## What Guardian is

Guardian reads chat an operator already has the right to read, looks for the
pattern of an adult grooming a child, and puts anything that looks like it in
front of a person. That person decides whether it becomes a report to the
National Center for Missing and Exploited Children. Guardian does not make that
decision and cannot.

"Operator" means whoever runs the service the chat is on: a Discord server
owner, or a platform using the API.

## What it holds

| | |
|---|---|
| Message text | Only where a conversation scored above nothing, and only for as long as its retention class allows. Text on a conversation that scored nothing is deleted within 24 hours. |
| Account identifiers | A salted hash, never the platform's own id. The salt is per operator, so the same person on two services produces two unrelated hashes and nothing joins them. |
| Ages | A band, one of six, never a birthdate. Recorded with where the band came from, because a band read off a Discord role is a different claim from one from a document. |
| Images and video | A SHA-256 fingerprint and the operator's own scanner verdict. Never the file. There is no code path in Guardian that can accept, fetch, store or log image or video data, and the ingest edge refuses any request carrying it. |
| Decisions | Every score and every reviewer decision, written to an append-only log that cannot be edited afterwards. |

## What it never holds

- Birthdates, legal names, addresses, phone numbers or payment details.
- Image or video files, thumbnails, or URLs pointing at them.
- Direct messages. Guardian reads guild channels an operator installed it into
  and nothing else, and Discord does not grant it DM access.
- Anything from a channel an operator excluded, including threads inside it.

## How long

Deletion is a scheduled job, not a promise. Every stored row carries the class
it was written under and the date it expires.

| Class | Applies to | Kept |
|---|---|---|
| Ephemeral | A conversation that scored nothing | Raw text gone within 24 hours; the numeric features remain |
| Watch | A conversation under review | 30 days |
| Case | A conversation two reviewers confirmed and reported | One year, which is the preservation duty under 18 USC 2258A |
| Legal hold | Set by a person, never by a score | Until a named custodian releases it |

The same 24-hour cutoff applies to the message queue, not only to the database.

## Who sees it

- **Reviewers at the operator.** They see the conversation. Confirming a report
  needs two of them, and the second cannot be the first.
- **NCMEC**, if and only if two reviewers agree a report should be filed.
- **Nobody else.** There is no cross-operator sharing without an explicit opt-in
  flag on the operator's own record, and it is off by default.

Guardian never publishes anything, never contacts law enforcement directly, and
has no feature that names or exposes a person anywhere. There is exactly one
reporting path and it is the CyberTipline.

## What Guardian will not say about you

Guardian assigns a risk level to a conversation. It never labels a person. Every
string it can produce is checked against a guard that refuses accusatory
language, and that guard runs over the source at build time as well as at
runtime.

## Automated decisions

No account is actioned on an automated decision alone. The highest level a model
can reach is "needs review". Only a human reviewer, confirmed by a second human
reviewer, can produce the level that leads to a report.

## Requests

An operator can ask for what Guardian holds about their service, and can ask for
it to be deleted. Because identifiers are salted per operator and Guardian holds
no names, a request about one person has to come through the operator, who is
the only party able to say which hash is whose.

## Where this is enforced

| Claim | Enforced in |
|---|---|
| No media bytes | `apps/ingest/src/media-guard.ts`, `packages/schema/src/media-text.ts` |
| Salted per-operator identifiers | `packages/schema/src/ids.ts` |
| Bands, not birthdates | `packages/schema/src/agebands.ts` |
| Scheduled deletion, including the queue | `apps/ingest/src/retention-job.ts` |
| Two humans before a report | `apps/review/src/lib/decisions.ts` |
| No accusatory language | `packages/schema` accusation guard, run over source and at render |
| Append-only decision log | `packages/audit` |
