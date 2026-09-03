# Phase 1 status

Kernel v0 and the Discord bot (DESIGN.md section 11, step 1). This page says what exists, what it is backed by, and what is still open. It is updated as the phase moves.

## Built

| Component | Where | Backed by |
|---|---|---|
| Canonical types and validators | `packages/schema/src/types.ts` | zod, mirrored in `prisma/schema.prisma` |
| Age bands, gap multiplier | `packages/schema/src/agebands.ts` | 5 tests |
| Normalizer: emoji, leet, confusables, zero-width, spacing, diacritics | `packages/schema/src/normalize.ts` | 10 tests, index map back to the original text |
| Versioned lexicon with per-customer extension | `packages/schema/lexicon/v1.json`, `src/lexicon.ts` | schema-validated at load |
| Sextortion script corpus | `packages/schema/corpus/sextortion-v1.json` | 15 templates from the documented patterns |
| Per-customer salted uid hashing, HMAC signing | `packages/schema/src/ids.ts` | 7 tests |
| Retention classes, escalation, expiry | `packages/schema/src/retention.ts` | 5 tests |
| Accusation guard and workspace source scan | `packages/schema/src/language.ts` | 5 tests, one of which walks every `.ts` and `.py` file |
| Hash-chained audit log, tamper detection naming the row, Postgres store with an advisory lock per append | `packages/audit` | 13 tests, plus the section 10 tamper test, plus the concurrent-append e2e |
| Ingest edge: auth, HMAC, media refusal, PII minimization, per-customer stream | `apps/ingest` | 62 tests |
| Prisma customer store: key hash only, salt, violations table, operator CLI (`create-customer`, `verify-audit`) | `apps/ingest/src/prisma-customers.ts`, `cli.ts` | 17 tests |
| Retention sweep, scheduled hourly from `main.ts`; skips legal holds and bundles with a report | `apps/ingest/src/retention-job.ts` | 3 tests |
| Signal detectors over the lexicon | `apps/scorer/src/detectors` | see kernel tests |
| MinHash + LSH script index, byte-identical in TS and Python | `apps/scorer/src/detectors/minhash.ts`, `services/ml/app/scripts.py` | parity test, `pnpm parity` |
| Pair trajectory: progression, velocity, asymmetry, age gap, economic, payment-after-media join | `apps/scorer/src/pair.ts` | 14 kernel tests |
| Actor skew and graph features: fan-out, new-account burst, alt clustering | `apps/scorer/src/actor.ts` | 6 tests |
| Rule fusion with the two structural gates | `apps/scorer/src/fusion.ts` | 4 tests |
| Evidence bundle, anchored to the audit head | `apps/scorer/src/bundle.ts` | 6 tests |
| Prisma kernel store over `pairs` and `actors`, retention ratchet | `apps/scorer/src/prisma-store.ts` | see scorer tests |
| Event row persistence: text kept by tier, versions, capped excerpts | `apps/scorer/src/persist.ts` | see scorer tests |
| Redis Streams worker and signed webhook dispatch, customers loaded from the table | `apps/scorer/src/worker.ts`, `webhook.ts` | e2e below |
| Customer SDK with client-side byte refusal | `packages/sdk-ts` | 11 tests |
| Discord bot: config, role to band, mapping, alerts, actions, pipeline, report draft | `apps/discord-bot` | 31 tests |
| Slash commands: `/guardian setup, role, trusted, timeout, exclude, status, export, verify`; Prisma guild config | `apps/discord-bot/src/commands.ts`, `prisma-config.ts`, `register.ts` | 27 tests |
| ML service: PII classifier with rule fallback, script index, stage classifier interface | `services/ml` | 16 tests |
| Evaluation suite | `scripts/eval` | 9 tests, 5 of them required gates |
| End to end: edge to stream to worker to Postgres on the nine message ladder, concurrent audit appends, violation row | `scripts/integration/e2e.test.ts` | 3 tests against the live local Postgres and Redis, skipped when either is down |

## The false-positive traps, as code

DESIGN.md section 5 lists what will burn you for each signal. Each is a multiplier in `gate()` in `apps/scorer/src/pair.ts`:

| Signal | Trap | Gate |
|---|---|---|
| Supervision probe | Peers ask this too | x0.3 without an age gap or a lopsided conversation |
| Migration ask | Kids swap handles constantly | x0.35 same band, x0.6 without an age gap, x1.3 for a concrete handoff |
| Economic bait | Trading and giveaways are everywhere | x0.25 unless adult to minor |
| Age or relationship framing | Teen romance is lawful | x0.15 same band minors |
| Image solicitation | Selfie exchange among friends | x0.4 without a probe or migrate stage first |
| Meetup logistics | Local friends make plans | stays a signal, stops being critical, without an age gap |
| Threat template | Almost none | no gate |

The `false-positive traps` eval test runs 300 conversations per class and asserts both that none reach T2 and that the detectors fired on at least half, so a class that never trips anything cannot pass by silence.

## What the eval numbers mean

`pnpm eval` prints a header saying this and it bears repeating. The conversations are generated from case-file structure because every public grooming dataset is decoy-based and none can be mirrored. The generators draw on the same phrase families the lexicon holds. A 100% here is a floor, not a result. The first honest precision number comes from reviewer decisions on real traffic, which is why the bot ships to three friendly servers before anything else.

## Decisions from the first review pass

These changed behaviour, not just code.

- **Everything the bot remembers is keyed by guild.** One process serves every
  guild under one customer id and one salt, so the same two Discord ids hashed
  to the same pair key in every server. `MemoryPairLookup` and
  `BotPipeline.timelines` now key on `guildId` first, `PairLookup.history` and
  `exportBundle` take the guild, and `exportBundle` returns null rather than
  falling back to rows from somewhere else. Before this, an owner of any server
  the bot was in could run `/guardian export` on two ids and receive another
  server's retained message text (rule 8).
- **`/guardian status` answers by permission.** Any member still gets the overt
  disclosure rule 3 requires: Guardian is here, and whether it is scoring.
  Manage Server gets the rest. The excluded channel list in particular is a map
  of where Guardian does not look and no longer goes to everyone.
- **`PrismaPairStats` is no longer wired into the bot.** The pairs table has no
  guild column, so its counts are the whole deployment's. `/guardian status`
  reports the in-process, guild-scoped counts until pairs carry a source id.
- **`guild_configs` is keyed on (guildId, customerId).** Migration
  `20260903200000_guild_config_customer_key`. The read was tenant-scoped and
  the upsert was not, so a second deployment sharing the database rewrote the
  customer id of a row it could not read and the first deployment silently fell
  back to defaults.
- **Both gateway listeners are guarded** (`registerHandlers` in `bot.ts`), with
  an `Events.Error` listener and a process-level `unhandledRejection` backstop.
  discord.js re-emits a rejected listener promise as an `error` event, so a
  deleted mod channel in one guild used to end the process for every guild.
- **The dead-letter stream carries no payload.** `guardian:dead:<customer>` has
  no retention class, no expiry and nothing that sweeps it, so the copied event
  JSON kept raw message text past the 24 hour T0 window. Entries now name the
  customer, stream, stream id, external id, reason and delivery count. There is
  no replay from the dead-letter stream any more; a replay path needs a
  Postgres row under an explicit retention class.
- **`reclaimStale` no longer acknowledges what XCLAIM declined to return.**
  XCLAIM omits an entry both when it was trimmed and when another consumer
  claimed it first, and acking on that guess dropped a message that was still
  being processed elsewhere. Redis prunes trimmed ids from the pending list
  itself.
- **Pair signal excerpts follow the tier.** `putPair` wrote quoted spans for
  every pair, including ones the model only ever scored T0, and the 30 day pair
  clock kept them. Excerpts are now written only while the pair's own tier
  retains text; excerpts already stored are left alone, so a pair that reached
  T2 and fell back does not lose them. The row itself stays WATCH_30D because
  the kernel needs the trajectory across days.
- **Retention runs on our clock.** `minimize` stamps the expiry from
  `receivedAt` rather than the customer's `ts`, `inboundEventSchema` refuses a
  `ts` more than five minutes ahead (`MAX_EVENT_CLOCK_SKEW_MS`), and
  `clearExpiredText` filters on `createdAt`. A broken customer clock could
  otherwise put `expiresAt` in 2099, which no sweep predicate would ever match.
  Backdated events are still accepted; a backfill is legitimate.
- **The ingest quota is per customer.** The pre-auth brake stays on the source
  address but is loose (3000/min); the 600/min quota is charged to the customer
  id resolved from the key. Behind a proxy every customer is the same peer
  address, so one anonymous flood used to refuse every real customer's batches.
  `GUARDIAN_TRUST_PROXY` takes a hop count or proxy addresses, never `true`.
- **The e2e never deletes audit rows.** seq is one global sequence, so deleting
  a run's entries out of the middle leaves a gap that `verify-audit` reports as
  a broken chain with no repair. The suite now appends under the deployment's
  own `AUDIT_CHAIN_SECRET` (environment, or the repo `.env`), leaves its rows
  in place, asserts the chain still verifies from the root, and skips unless
  the database is local.

## Open

- **Roblox PII Classifier v2 weights.** The loader is in place behind `GUARDIAN_PII_MODEL`. Wiring the real weights and comparing against the rule fallback on the Roblox benchmark is the next ML task.
- **Lexicon mining.** DESIGN.md 6.5 says to periodically mine T2+ confirmed cases for tokens the detectors missed. No confirmed cases yet.
- **Discord message-content intent verification** above 100 servers, around week 10.
- **Bot audit log and pair counts.** The bot's audit chain is still in memory even with `DATABASE_URL` set, because nothing seeds a customer row for the guild's `GUARDIAN_CUSTOMER_ID`. Pair counts and the export timeline are in process and guild-scoped, so both are empty after a restart. Database-backed counts need a guild or source id on `pairs`.
- **Worker partition list is loaded once.** A new customer needs a scorer restart. Ids from the `GUARDIAN_CUSTOMER_IDS` fallback have no webhook and cannot persist rows until the customer row exists.
- **Open-channel messages have no events row.** The kernel returns null for events with no `targetUid`, so only actor state is written for them.
- **Actor skew read back 0 after the smoke ladder** (fanOut7d 1, minorFanOut7d 1). That is `scoreActor`'s output passed straight through `recordTier`; worth a look by the kernel owner.
- **Redis stream retention.** `guardian:events:<customer>` is trimmed by `MAXLEN ~ 100000` and has no TTL, so a queued event's raw text can sit in Redis well past the 24 hour T0 window even after it has been scored and the row's text dropped. Rule 7 wants a time bound here: an `XTRIM MINID` by timestamp, or a TTL on both the event and dead-letter key families. Not addressed by the dead-letter fix above, which only stops the copy.
- **`events.features` keeps excerpts for T0 rows.** `persist` drops `events.text` by tier but writes the detection excerpts into the `features` json regardless, and the sweep's text clear does not touch that column. Same shape as the pair signals fix, one table over.
- **Retention ratchet is read-modify-write.** `keepRetention` in `prisma-store.ts` and `persist.ts` omits the class from the update patch when it has not changed but always writes `expiresAt` from the pre-upsert read, so a concurrent escalation can have its expiry pulled back. Unreachable today because nothing produces a class above WATCH_30D until a reviewer can record T3. It has to be a guarded single statement (`updateMany` with `expiresAt: { lt: computed }`, or `GREATEST`) before the phase 2 review path lands.
- **`events.expiresAt` is NOT NULL** while pairs, actors and bundles are nullable, so LEGAL_HOLD on an event cannot be open ended. The sweep excludes LEGAL_HOLD regardless of the column.

### Schema review findings not yet applied

The critical and high findings from the schema review are in migration `20260903183320_audit_lock_and_restrict_cascades`: the audit table has no foreign key and no sequence (seq is assigned under an advisory lock in `packages/audit`, with unique constraints on `prevHash` and `hash`), pairs have no foreign key to actors, and pair, review, bundle and report relations are Restrict rather than Cascade. The sweep skips bundles that have a report. What remains:

- **F3, sweep and actors.** An actor row still expires on its own 30 day clock while a pair it belongs to may be under CASE_1Y. The pair survives (no cascade now), but the actor's graph state does not. Either the sweep skips actors that still own a pair above EPHEMERAL_24H, or an escalation on a pair clears the actor's expiry.
- **F4, report creation.** When the CyberTipline client lands (phase 3), creating a report must set the bundle to CASE_1Y with `expiresAt = preserveUntil` in the same transaction.
- **F5, worker ack.** `runWorker` acks a message even when the audit append or persist fails, so a failed append leaves a scored and dispatched event with no chain entry. The lock removes the race that caused this; the ack policy is still worth deciding.
- **F6, bannedHints index.** `store.bannedHints(customerId)` runs per event and scans every actor of the customer. Add a partial index on `actors(customerId) WHERE actionedAt IS NOT NULL` by raw SQL and cache the set per customer.
- **F7, sweep indexes and batching.** `clearExpiredText` has no usable index and the deletes are unbounded single statements. Add `(customerId, expiresAt)` on events, pairs and bundles, a partial index for the text clear, and batch the deletes per customer.
- **F8, per-event transaction.** Nine round trips per event with no transaction. Two consumers on one partition can interleave writes to the same pair. Keep one consumer per partition until a row lock or a version column lands.
- **F9, typed columns.** `firstStageAt` and `messageCounts` as Json, `knownCsamVerdict` and report `status` as free strings. Columns and enums would let the order-of-stages metric use an index.
- **F10, database guard for rule 1.** CHECK constraints on `text` length, `mediaSha256` shape and JSON column size by raw SQL, plus a schema test that no model has a Bytes field or a birthdate column.
- **F11, rows without retention.** CustomerViolation, Review, GuildConfig and Customer carry no retention class or expiry. GuildConfig has no foreign key to Customer.
- **F12, timestamps.** All DateTime columns are `TIMESTAMP` without time zone. Moving to `@db.Timestamptz(3)` is cheap now and expensive later. The reviewer queue would also benefit from a partial index on `pairs(customerId, updatedAt) WHERE resolvedAt IS NULL AND tier IN ('T2','T3')`.
- **Sentinel customers.** `ensureSentinels` still upserts `system` and `unknown` customer rows. Since the audit table no longer references customers they are only needed for `customer_violations`, which never writes for them. They can go, along with the scorer's filter for them, if the founder prefers.

## Not in phase 1, by design

Stage classifier (phase 2). Reviewer UI (phase 2). Learned fusion (phase 2, needs labels). Platform SDK over HTTP in production (phase 3; the SDK exists, the deployment does not). CyberTipline ESP client (phase 3, needs a registered customer). Investigator and parent surfaces.
