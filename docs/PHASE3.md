# Phase 3 status

Platform SDK and reporting (DESIGN.md section 11, step 3). This page says what
exists, what it is backed by, and what is still open. Same shape as
[PHASE1.md](PHASE1.md).

Phase 3 is the reporting product, and one rule shapes all of it. There is one
reporting path, the NCMEC CyberTipline, and no other (CLAUDE.md rule 4). The
customer is the electronic service provider and the reporter of record under
18 USC 2258A. Guardian is their agent, files on their credentials, and has no
account of its own. Guardian never holds image or video bytes, so a report
names a file by sha256 and carries the operator's own scanner verdict beside it
and nothing else (rule 1). A report may only be built from a reviewer-confirmed
T3, and T3 comes from exactly one function (rule 6).

## Built

| Component | Where | Backed by |
|---|---|---|
| CyberTipline report envelope, zod-validated | `packages/report/src/schema.ts` | The full incidentType enumeration and the reportAnnotations vocabulary, both verbatim from the public ESP API documentation |
| Report builder, a projection of the evidence bundle | `packages/report/src/builder.ts` | Five refusals: anything but a reviewer-confirmed T3, a media row with no hash, a bundle and a customer that name different customers, byte-shaped free text anywhere in the envelope, and an accusation in a reviewer note |
| Report completeness scorer | `packages/report/src/completeness.ts` | Blocking, degrading and enriching severities, with `jurisdictionDeterminable` as its own boolean. Blocks a filing whose incident type is the fallback, and reports a missing legal basis |
| ESP API client, test by default | `packages/report/src/client.ts` | 86 tests in the package, none of which reaches the network. Refuses a report built for a different environment, and one built for a different customer than the credentials belong to |
| One-year preservation predicate and sweep partition | `packages/report/src/preservation.ts` | 18 USC 2258A. Fails closed: a row that says a report was submitted and carries no preservation date is preserved, not deleted |
| Evidence bundle as a superset of the report fields | `packages/schema/src/types.ts`, `apps/scorer/src/bundle.ts` | 46 bundle tests in `apps/scorer`. Reporter of record, reviewer context, per-instant local time and offset, per-excerpt bands, and a 17-field completeness pre-flight |
| Durable webhook delivery with a retry schedule | `packages/schema/src/delivery.ts`, `apps/ingest/src/delivery.ts` | 40 tests. Equal jitter, base 1s, factor 2, cap 1h, 8 attempts then dead, and a `Retry-After` that can raise the wait but never lower it below the schedule; a strict payload schema that refuses text, excerpt, transcript, timeline and media keys at any depth |
| Delivery drain worker with `FOR UPDATE SKIP LOCKED` | `apps/ingest/src/delivery-worker.ts` | Claims reclaimed after 60s, so a crashed worker frees its rows, and settling is fenced on still holding the claim so a stale worker's result is dropped rather than written |
| Scorer dispatch enqueues instead of firing once | `apps/scorer/src/webhook.ts`, `worker.ts` | `useDeliveryQueue(new PrismaDeliveryStore(db))` in `main()`. Signing is unchanged, so a customer already verifying with `packages/sdk-ts` keeps working |
| Webhook deliveries swept | `apps/ingest/src/retention-job.ts` | A `deliveries` step beside events, pairs, actors and bundles. Rule 7: every stored row has a class and a scheduled deletion |
| Where a webhook URL may point | `packages/schema/src/webhook-target.ts` | Moved out of the settings page so the durable worker runs the same check immediately before every request, which is the one that closes DNS rebinding on a queued row |
| Media bytes in free text | `packages/schema/src/media-text.ts` | The edge scans customer events; this scans everything a person typed. The reviewer console refuses such a note at write time and the report builder refuses the envelope |
| Python SDK matching `packages/sdk-ts` | `packages/sdk-py` | 57 pytest cases mirroring the TS suite, plus a pinned signature-parity hex |
| Regulator and counsel audit export | `packages/audit/src/export.ts` | 31 tests. Self-contained artifact, offline `verifyExport`, a scope refusal citing rule 8, and a refusal to pass an artifact where no row could be recomputed |
| Phase 3 end to end | `scripts/integration/e2e.test.ts` | 3 new tests against the live local Postgres and Redis: T2 to reviewer-confirmed T3 to a built report, a target refusal then delivery backoff, audit export verified offline |

## What it is backed by, and what is inference

The report package separates the two on purpose, in `REPORT_FIELD_PROVENANCE`
in `packages/report/src/schema.ts`, so nobody reads an inference as a fact.

Verified against the public NCMEC documentation:

- Base URLs, the seven endpoints, HTTP basic auth, credentials issued per ESP
  on request with no self-registration.
- The eight `incidentType` values verbatim, and the eight `reportAnnotations`.
- The children of `incidentSummary`, `reporter`, `personOrUserReported`,
  `victim`, `ipCaptureEvent`, `estimatedLocation` and `fileDetails`.
- Unfinished reports auto-delete after 24 hours, or an hour after the last
  modification, whichever is later.

Recorded as inference, not fact:

- SHA256 as an accepted `hashType`. The documentation names MD5 and SHA1 as
  examples and enumerates nothing, so the field is a free string.
- That a hash-only file record is accepted at all. See the open item below.
- XSD cardinality and element ordering. `GET /xsd` is authoritative and has not
  been read against this module.

## Decisions this work made

- **Sextortion is an annotation, not an incident type.** The taxonomy has no
  sextortion incident type. A sextortion case files as Online Enticement of
  Children for Sexual Acts with the `sextortion` annotation set. The reviewer
  console's incident-type preselect has to reflect that.
- **The incident-type mapping is deliberately narrow.** Almost every Guardian
  signal maps to Online Enticement. Child Sexual Molestation, Child Sex Tourism,
  Misleading Domain Name, Misleading Words and Unsolicited Obscene Material are
  in the enumeration and are not derivable from anything Guardian observes, so
  they stay selectable by a reviewer from facts Guardian does not hold. Deriving
  them anyway would be Guardian asserting something it cannot support (rule 5).
  Child Sex Trafficking needs economic bait and meetup logistics together; the
  CSAM type is reachable only from the operator's own scanner verdict.
- **`EspClient` has no `upload()` and no `fileinfo()`.** They do not exist,
  rather than existing and throwing, and a test asserts their absence. Guardian
  holds no bytes, so there is nothing for them to send.
- **A salted-hash `espIdentifier` is blocking, not degrading.** NCMEC cannot
  resolve it, so it works like no identifier at all. The customer maps the hash
  back to their own account id before submit. Guardian holds only the hash by
  design (rule 8), so this is a customer step the builder cannot fix.
- **Production takes an exact literal.** `EspClient` reaches production only on
  an explicit argument or `NCMEC_API_ENV` set to exactly `production`. Empty
  string, `prod`, `PRODUCTION` and `production ` with a trailing space all
  resolve to test, each with its own assertion. `submit()` also refuses a report
  built for a different environment than the client points at.
- **The scorer does not depend on the ingest server.** It imports
  `@guardian/ingest/delivery`, a subpath that pulls in no Fastify, and
  `PrismaDeliveryStore` satisfies the `DeliveryEnqueuer` port structurally.
- **Session identity moved out of the Next request.**
  `apps/review/src/lib/session.ts` now holds `Session`, the roster and the
  signed cookie; `lib/auth.ts` re-exports all of it and keeps only the three
  functions that read the request. `@/lib/auth` is unchanged for every route.
  Without the split, `lib/decisions.ts` could not be imported outside a Next
  server, and rule 6 says the end-to-end test has to drive that one function
  rather than a copy of it.
- **A scoped audit export shows other customers' rows as position and hash.**
  Enough to keep the links verifiable across a gap, and nothing else: no
  customer id, no payload. If counsel decides even that is too much, the
  alternative is to drop the rows and give up link continuity.
- **An export where nothing can be recomputed is a refusal, not a pass.** A
  redacted row cannot be hash-recomputed by the reader, so `verifyExport`
  returns mode `structural`. Where every row is redacted, `recomputed` is 0 and
  the chain key was never used at all: the right key, the wrong key and an
  empty string returned the same `ok: true`, and every remaining check compares
  values that live inside the artifact, both sides of which a forger holds. So
  that case now fails with reason `nothing_recomputed`, and a caller who wants
  a positional check has to pass `allowStructural` and say so in their own
  report. The refusal keys on `recomputed === 0` rather than on the mode,
  because an ordinary scoped export is already partly structural: another
  customer's rows are withheld, and it still proves what it carries.

## What the adversarial review changed

Every finding below was reproduced and then argued against before it was fixed,
and each one carries a regression test.

- **The reporter of record is now bound to the evidence.** `buildReport` took a
  bundle and a `ReportCustomer` as two independent arguments and never compared
  them, so a transposed argument or a console holding several customers would
  have filed one provider's traffic under another provider's name, on their
  credentials, with their contact person named as the 2258A reporter. The
  envelope carries a `customerId`, the build refuses a mismatch with a
  `customer_mismatch` code, and `EspClient.submit` refuses a report that is not
  the customer whose credentials it holds. The comparison keys on customer id,
  not on provider name, because the bundle's provider name is nullish.
- **Reviewer notes are scanned for bytes and for accusations, at write time.**
  A reviewer note is the one free-text channel into a federal filing that never
  crosses the ingest edge: it is typed into the console, stored, copied verbatim
  into the narrative, and POSTed. `packages/schema/src/media-text.ts` holds the
  two byte-shaped patterns the edge already used, plus an unanchored data-URI
  form for a URI pasted mid-sentence, and `recordDecision` refuses a note
  carrying either. The accusation guard runs there too. Both run again at the
  builder as a backstop, naming the field rather than discarding the filing,
  but the write-time check is the load-bearing one: refusing at build time
  strands an already-recorded T3 that the console has no edit path for.
- **Jurisdiction and legal basis reach the recipient.** Both were computed and
  stored and neither was on the wire. `additionalInfo` now carries them, the
  jurisdiction line saying in words that it is the reporting provider's own
  jurisdiction and not the reported account's location, because `additionalInfo`
  is a child of `personOrUserReported` and an analyst would otherwise read it as
  the latter. If the XSD turns out to carry a reporter-level element for either,
  they move there.
- **A defaulted incident type blocks the filing.** The module refuses to derive
  five of the eight types because deriving them would be Guardian asserting
  something it cannot support (rule 5), and then defaulted the sixth from
  nothing. The fallback stays, because filing with no type is worse, but
  `signalsToIncidentType` reports whether anything drove it, the envelope
  records `incidentTypeSource`, the completeness scorer blocks on `default`, and
  `BuildReportOptions.incidentType` takes a reviewer's own choice.
- **The delivery worker no longer follows a redirect.** `attemptDelivery` sent
  with undici's default `follow`, so a customer endpoint that passed every
  target check could answer `307 Location: http://169.254.169.254/` and walk the
  signed POST, method and body intact, into Guardian's own network. It is
  `redirect: "manual"` now, and a 3xx or an opaque redirect is dead with
  `redirected`.
- **The target is checked immediately before every request.** The save-time
  check in the settings page sees the name the operator typed, not what it
  resolves to an hour later on the eighth retry. `checkWebhookTarget` moved from
  `apps/review/src/app/settings` into `packages/schema` so the worker can run
  it; a refusal is dead with `target_refused`, because eight attempts at a
  refused target is eight probes.
- **`Retry-After` raises the wait and never lowers it.** A shedding load
  balancer answering `429` with `0`, or an HTTP-date form read against thirty
  seconds of clock skew, collapsed the whole eight-attempt budget to zero
  backoff and dead-lettered a customer's queued tiers in about two seconds. The
  honoured delay is now the larger of the header and the schedule.
- **Settling is fenced to the claim.** A worker that overran the 60s claim could
  write its result over the row a second worker had already delivered,
  resurrecting it for a third send with an attempt counter that had gone
  backwards, or mark delivered a row nobody got a 2xx for. `settle` takes the
  `claimedBy` the worker read off the row and updates conditionally; a dropped
  result is reported as `settled: false`. A pass also stops attempting rows once
  the batch has outrun its own claim, and the worker refuses to start where
  `DELIVERY_TIMEOUT_MS` is not shorter than `DELIVERY_CLAIM_TIMEOUT_MS`.
- **One bad row no longer stops delivery for every customer.** `claimDue` sat
  outside the try, and `runDeliveryWorker` and `main()` have no catch, so a
  transient Postgres error or a row the strict payload schema could not read
  exited the process. `CLAIM_SQL` has no customer predicate and orders by
  `nextAttemptAt`, so a poison row sorted first on every pass and a supervisor
  turned it into a crash loop whose only signal was a restart count. The claim
  is wrapped, and a row that will not parse is marked dead with
  `unparseable_row` instead of taking its batch down.
- **The Python SDK's cycle guard held addresses, not objects.** `_as_plain`
  builds a throwaway dict per pydantic sub-model; a set of `id()` values keeps
  no reference to it, CPython reissued the freed address to the next sibling's
  dump, and that sibling's whole subtree was skipped unscanned. Two models side
  by side in a dict, which is the shape the README invites, came back clean. It
  holds live references now, like the TypeScript twin, so the module's claim
  that a payload one SDK refuses the other refuses too is true again.

## What the end-to-end test proves

`pnpm --filter @guardian/integration exec vitest run`, against the live local
Postgres and Redis. Six tests, three of them new:

1. The nine-message ladder reaches T2 through the real edge, stream and worker,
   the chain verifies from the root, and a data uri is refused with a violation
   row. (Phase 1, unchanged.)
2. A tenth message carrying a sha256 and the operator's verdict. A proposal is
   refused until `markExcerptsViewed` has actually written a read flag. The
   proposal writes no tier. The same reviewer is refused as their own second
   reviewer. A second reviewer's concurrence produces T3 and ratchets the pair
   to `CASE_1Y`. The report is then built from that bundle, its completeness is
   scored as jurisdiction-determinable from the customer's IP capture, and the
   serialized report is asserted to carry no data uri, no long base64 run, and
   no key that could hold a file.
3. A tier queued as a durable delivery. The real target check refuses the row
   before anything is signed, because the endpoint name does not resolve; then
   the backoff schedule asserted exactly (500ms, 1s, 2s under a pinned jitter)
   against a refusing endpoint, and settled on the next 2xx.
4. The run's slice of the audit chain exported and verified offline with nothing
   but the artifact and the key, with the chain key asserted absent from the
   artifact and other customers' rows asserted to be position and hash only.

Cleanup removes this run's reviews, deliveries, bundles, pairs, events, actors
and the customer. It never deletes audit rows: seq is one global sequence and
deleting from the middle of it breaks verification for the whole chain with no
repair.

## Open

- **The hash-only file record is unconfirmed, and it is a product question, not
  an implementation detail.** The CyberTipline API has no documented hash-only
  file route. The documented path is `POST /upload` with multipart bytes then
  `POST /fileinfo`. Ask NCMEC at ESP registration whether a hash-only
  `fileDetails` record is accepted. If it is not, the operator uploads the bytes
  themselves from their own systems under their own credentials and Guardian's
  report is a text report that names files by hash.
- **Nothing populates `jurisdiction`, `legalBasis`, `timezone` or `reporter` in
  production.** `buildEvidenceBundle` takes them as inputs and there is no
  Customer column for a timezone, a registered provider name, an ESP id or a
  named contact. Until a schema owner adds those columns and the call sites in
  `apps/discord-bot/src/pipeline.ts` and `apps/review` pass them, every bundle
  honestly reports those fields as empty. The e2e supplies them to prove the
  path.
- **`reported_account_ip_capture` is always empty, by design.** NCMEC's
  `ipCaptureEvent` is what makes a report routable and Guardian captures no IPs.
  It is listed as an explicit empty field so the customer supplies it at filing
  rather than discovering the gap afterward.
- **Two completeness scorers.** `assessCompleteness` in `packages/schema` is
  per-bundle at generation time over 17 named fields; `scoreReportCompleteness`
  in `packages/report` is per-envelope at filing time and checks things only the
  envelope knows. They are complementary rather than duplicative. Somebody has
  to decide whether the console shows one or both.
- **No per-customer credential store.** `NCMEC_API_USER` and `NCMEC_API_PASS`
  belong to the customer, not to Guardian. A multi-customer deployment needs an
  encrypted per-customer store, which is not in `packages/report`.
- **No idempotency key on a delivery.** A scorer stream entry redelivered after
  a successful persist enqueues a second row and the customer gets the tier
  twice. The shape is a unique `(customerId, kind, externalId)` with the
  external id threaded through `toWebhookPayload`.
- **`PrismaDeliveryStore.claimDue` has no test against a live database.** The
  row-lock behaviour is tested against the memory twin. The migration has now
  run, so it is worth one manual pass with two workers.
- **Report creation does not yet ratchet the bundle.** PHASE1 F4: creating a
  report has to set the bundle to `CASE_1Y` with `expiresAt = preserveUntil` in
  the same transaction. `preservation.ts` has the predicate; nothing calls it
  from a submit path, because nothing submits yet.
- **`refuseDeletionUnderPreservation` is not wired into the sweep.** The
  deletes are single SQL statements with no row read, so using the predicate
  means changing that shape. The bundle step already skips a bundle that has a
  report, which covers the case that exists today.
- **`apps/ingest/src/index.ts` exports `delivery.js` but not
  `delivery-worker.js`.** The worker is a process, not a library. Railway needs
  it as a second process; the script is `pnpm --filter @guardian/ingest run
  delivery-worker`.
- **No console control sets the incident type.** `BuildReportOptions.incidentType`
  takes a reviewer's selection and the completeness scorer blocks a filing whose
  type is the fallback, but nothing in `apps/review` offers the choice yet. Five
  of the eight types are reachable only that way.
- **The checked address is not the connected address.** The target check runs
  immediately before the request, which closes the ordinary rebinding case. A
  name that changes in the window between the check and the connect is still
  open, and closing it means an agent `lookup` that connects to the address that
  was checked rather than resolving again.
- **A dropped delivery result is not surfaced.** `AttemptOutcome.settled` is
  false where a stale worker's result was discarded, which means the customer
  received the tier twice. Nothing counts it, and its rate is the signal that
  the batch size and the claim timeout are mismatched.
- **No NCMEC registration.** Everything above is exercised against the test
  environment or against an injected fetch. The first real submission needs a
  registered customer, which is a business step.

## Not in phase 3, by design

Investigator triage (phase 4). Parent app (phase 5). The stage classifier
fine-tune and learned fusion are phase 2 and still open. Voice and video are
declared in the DESIGN.md section 5 catalog at weight `none` so they read as a
known false negative rather than an absence.
