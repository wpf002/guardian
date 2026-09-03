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
| Hash-chained audit log, tamper detection naming the row | `packages/audit` | 13 tests, plus the section 10 tamper test |
| Ingest edge: auth, HMAC, media refusal, PII minimization, per-customer stream | `apps/ingest` | 28 tests |
| Retention sweep | `apps/ingest/src/retention-job.ts` | 3 tests |
| Signal detectors over the lexicon | `apps/scorer/src/detectors` | see kernel tests |
| MinHash + LSH script index, byte-identical in TS and Python | `apps/scorer/src/detectors/minhash.ts`, `services/ml/app/scripts.py` | parity test, `pnpm parity` |
| Pair trajectory: progression, velocity, asymmetry, age gap, economic, payment-after-media join | `apps/scorer/src/pair.ts` | 14 kernel tests |
| Actor skew and graph features: fan-out, new-account burst, alt clustering | `apps/scorer/src/actor.ts` | 6 tests |
| Rule fusion with the two structural gates | `apps/scorer/src/fusion.ts` | 4 tests |
| Evidence bundle, anchored to the audit head | `apps/scorer/src/bundle.ts` | 6 tests |
| Redis Streams worker and signed webhook dispatch | `apps/scorer/src/worker.ts`, `webhook.ts` | integration pending a customer |
| Customer SDK with client-side byte refusal | `packages/sdk-ts` | 11 tests |
| Discord bot: config, role to band, mapping, alerts, actions, pipeline, report draft | `apps/discord-bot` | 25 tests |
| ML service: PII classifier with rule fallback, script index, stage classifier interface | `services/ml` | 16 tests |
| Evaluation suite | `scripts/eval` | 9 tests, 5 of them required gates |

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

## Open

- **Persistence for kernel state.** `KernelStore` has a memory implementation. The Prisma-backed one against `pairs` and `actors` is the first thing to write before the bot runs on a real server for more than a session.
- **Prisma-backed customer and audit stores.** `apps/ingest/src/main.ts` and `apps/scorer/src/worker.ts` use in-process stores. The delegates are shaped for Prisma already.
- **Roblox PII Classifier v2 weights.** The loader is in place behind `GUARDIAN_PII_MODEL`. Wiring the real weights and comparing against the rule fallback on the Roblox benchmark is the next ML task.
- **Slash commands.** `/guardian setup`, `/guardian roles`, `/guardian export` are not written. The pipeline they call is.
- **Lexicon mining.** DESIGN.md 6.5 says to periodically mine T2+ confirmed cases for tokens the detectors missed. No confirmed cases yet.
- **Discord message-content intent verification** above 100 servers, around week 10.

## Not in phase 1, by design

Stage classifier (phase 2). Reviewer UI (phase 2). Learned fusion (phase 2, needs labels). Platform SDK over HTTP in production (phase 3; the SDK exists, the deployment does not). CyberTipline ESP client (phase 3, needs a registered customer). Investigator and parent surfaces.
