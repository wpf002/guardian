# Guardian Privacy Policy

**Draft. Not published, and not reviewed by counsel.** Every factual claim below
is checked against the code and cited to the file that enforces it, so a lawyer
reading it can verify rather than take it on trust. The wording is theirs to
change; the facts are not.

Last checked against the code: 2026-09-13.

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
| Account names | The name Discord shows for an account in that server: its server nickname, or its Discord display name, or its username. Kept only while the account is in a conversation Guardian flagged, and deleted on that conversation's schedule. A person can choose to use their real name on Discord, and if they have, that is what is stored. The name is shown only to the operator's own reviewers, is never used as an id, and is never shared between operators. |
| Ages | A band, one of six, never a birthdate. Recorded with where the band came from, because a band read off a Discord role is a different claim from one from a document. |
| Images and video | A SHA-256 fingerprint and the operator's own scanner verdict. Never the file. There is no code path in Guardian that can accept, fetch, store or log image or video data, and the ingest edge refuses any request carrying it. |
| Decisions | Every score and every reviewer decision, written to an append-only log that cannot be edited afterwards. |

## What it never holds

- Birthdates, addresses, phone numbers or payment details. Guardian never asks for a legal name and never checks one.
- Image or video files, thumbnails, or URLs pointing at them.
- Direct messages. Guardian reads guild channels an operator installed it into
  and nothing else, and Discord does not grant it DM access.
- Anything from a channel an operator excluded, including threads inside it.

## How long

Deletion is a scheduled job, not a promise. Every stored row carries the class
it was written under and the date it expires.

An account name follows the conversation that flagged it. It is deleted when it
expires, and sooner if no flagged conversation includes that account any more.

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
it to be deleted. Identifiers are salted per operator, and Guardian keeps a name
only for an account in a flagged conversation, so a request about one person
has to come through the operator, who can say which account is theirs.

## Where this is enforced

| Claim | Enforced in |
|---|---|
| No media bytes | `apps/ingest/src/media-guard.ts`, `packages/schema/src/media-text.ts` |
| Salted per-operator identifiers | `packages/schema/src/ids.ts` |
| Names kept only for flagged conversations | `persistAccountName` in `apps/scorer/src/persist.ts`, which refuses a conversation that scored nothing |
| Names deleted with their conversation | `deleteExpiredNames` in `apps/ingest/src/retention-job.ts` |
| Bands, not birthdates | `packages/schema/src/agebands.ts` |
| Scheduled deletion, including the queue | `apps/ingest/src/retention-job.ts` |
| Two humans before a report | `apps/review/src/lib/decisions.ts` |
| No accusatory language | `packages/schema` accusation guard, run over source and at render |
| Append-only decision log | `packages/audit` |
