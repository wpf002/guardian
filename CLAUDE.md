# Guardian

Detection kernel + reporting pipeline for online child grooming, sextortion, and trafficking recruitment. Four surfaces: platform SDK/API, Discord bot, investigator triage, parent app.

Read `docs/DESIGN.md` before touching anything. It is the spec.

## Stack

TypeScript, pnpm, Turborepo. Fastify for services, Prisma + Postgres for state, Redis Streams for the event queue, Next.js for the reviewer UI. Python FastAPI only in `services/ml`. Deploys to Railway.

## Layout

```
apps/ingest        Fastify. Auth, schema validation, PII minimization, event write to queue. Rejects media bytes.
apps/scorer        Pair trajectory, actor skew, fusion, tier assignment, action dispatch.
apps/review        Next.js reviewer queue. Human decisions produce T3; the model never does.
apps/discord-bot   Discord gateway adapter. First shipping surface.
services/ml        Python FastAPI. Stage classifier, embeddings, Roblox PII classifier v2, MinHash script index.
packages/schema    Canonical Event / Pair / Actor / Tier types + zod validators. Single source of truth.
packages/sdk-ts    Customer-facing TS SDK wrapping the Event schema and webhook verification.
packages/audit     Hash-chained append-only log. Every score, reviewer action, and export goes through it.
scripts/           Bootstrap, dev, eval harness.
docs/              DESIGN.md (spec), design.html (rendered), ADRs as they happen.
```

## Non-negotiable rules (from DESIGN.md §2)

These are legal constraints, not style. Do not write code that violates them, and push back if asked.

1. Media is hash-only. No code path may accept, store, download, fetch, or log image/video bytes. `apps/ingest` drops any request carrying media bytes and records a customer-side violation.
2. No decoy or persona features. Guardian observes real traffic only. Never generate accounts, profiles, or messages that pose as a minor.
3. No covert interception. Parent surface is overt and device-owner-authorized. Platform and Discord surfaces act only with the operator's authority over their own service.
4. One reporting path: NCMEC CyberTipline (ESP API for platforms, drafted public-form bundle for Discord owners and parents). No "expose" feature, no direct-to-police feature, no public lists.
5. Guardian emits risk tiers and evidence bundles for human review. It never labels a person a predator. Check every UI string and log message for this.
6. Only a human reviewer can produce tier T3. The model tops out at T2.
7. Every stored row carries `customer_id` and `retention_class`. Deletion is a scheduled job. T0 raw text is gone within 24h.
8. Customer user IDs are salted-hashed per customer. No cross-customer joins without an explicit opt-in flag.
9. Store age bands (six, matching Roblox's scheme), never birthdates.

## Tiers

T0 nothing · T1 watch (retain 30d, no human) · T2 review (human queue ≤4h, operator may friction) · T3 report (reviewer-confirmed only; CyberTipline + 1-year preservation).

Any critical signal (threat template match, payment demand within minutes of a media event, meetup logistics with age gap, known-CSAM hash verdict from the operator) forces tier ≥ T2 regardless of the fused score.

## Conventions

- Every score row records `model_version`, `lexicon_version`, `fusion_version`.
- Feature workers are stateless; state lives in Postgres and Redis.
- Per-customer queue partitions so one noisy platform can't starve another.
- Normalization layer maps emoji/leet codes before tokenization (👻→snapchat, 💿→discord, "leVe"→leave). Lexicon lives in `packages/schema/lexicon/` and is versioned.
- Tests: vitest for TS, pytest for ML. The eval harness in `scripts/eval/` runs the DESIGN.md §10 suite; the base-rate simulation and teen-romance control are required before any threshold change merges.
- No em-dashes in code comments or docs. Plain sentences.

## Build order (DESIGN.md §11)

1. Kernel v0 + Discord bot (weeks 1–6). Normalizer, PII/migration classifier with Roblox weights, economic-bait entities, sextortion MinHash, fan-out graph, rule-based fusion, mod-channel alerts, evidence bundle export.
2. Stage classifier + review queue (weeks 6–12).
3. Platform SDK + NCMEC reporting (weeks 12–20).
4. Investigator triage (after a partner signs).
5. Parent app (last).

Current phase: **1**. Don't start work from later phases unless asked.

## External models and data

- Roblox PII Classifier v2: https://huggingface.co/Roblox/roblox-pii-classifier-v2 (weights available). Benchmark: https://huggingface.co/datasets/Roblox/roblox-pii-safety-for-chat-benchmark
- Roblox Sentinel v2: https://github.com/Roblox/Sentinel (framework; bring your own exemplars)
- Training data for the stage classifier: PANC (Vogt et al. 2021), PJZ/PJZC. All decoy-based; see DESIGN.md §12.
- Never pull, mirror, or cache any dataset that could contain CSAM. Text datasets only.
