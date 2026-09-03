# Guardian

Detection kernel and reporting pipeline for online child grooming, financial sextortion, and trafficking recruitment. One scoring engine, four surfaces:

| Surface | User | Status |
|---|---|---|
| Discord bot | Owners of kid-heavy game communities | Phase 1 (current) |
| Platform SDK / API | Small and mid-size games, chat apps, edtech | Phase 3 |
| Investigator triage | ICAC units, NGO victim-ID partners | Phase 4, partner-gated |
| Parent app | Parents of 8 to 15 year olds | Phase 5 |

Full spec: [docs/DESIGN.md](docs/DESIGN.md). Rendered version with the architecture diagram: `docs/design.html`. What is built so far and what is not: [docs/PHASE1.md](docs/PHASE1.md).

## What it does

Scores an event stream (who said what to whom, when, in what age band) for the documented predator playbook: contact, trust, supervision probe, off-platform migration, sexualization, coercion. Tracks progression and velocity per (actor, target) pair and distribution skew per actor, fuses them into four tiers, and routes anything above T1 to a human reviewer. Reviewer-confirmed cases become CyberTipline reports with a hash-chained evidence bundle and one-year preservation.

## What it refuses to do

Hold image or video bytes. Run decoy accounts. Intercept messages covertly. Report to anyone but NCMEC. Call anyone a predator. See `CLAUDE.md` for the full list; these are statutory, not stylistic. Several are enforced by code rather than by convention:

- `apps/ingest` refuses any request carrying media bytes, data URIs, media links, or byte-named fields, before parsing and before logging, and records a customer-side violation.
- `apps/scorer/src/fusion.ts` cannot return T3. Only a reviewer decision can.
- `packages/schema/src/language.ts` rejects accusatory strings, and a test walks the whole workspace for literals that would fail it.
- `packages/audit` is a hash chain whose verifier names the tampered row.

## Getting started

Requirements: Node 20+, pnpm 9+, Docker, Python 3.11+ with `uv`.

```bash
./scripts/bootstrap.sh
```

That installs dependencies, writes `.env` with a fresh audit secret, and starts Postgres and Redis. Ports are shifted off the defaults (5433 and 6381) so a database already on the host is not shadowed.

```bash
pnpm db:migrate        # apply the Prisma schema
pnpm test              # every package, plus the eval suite in quick mode (about 15s)
pnpm eval              # the full DESIGN.md section 10 suite (about 90s)
pnpm ml:test           # Python service tests
pnpm parity            # confirm the TS and Python MinHash indexes agree
```

To run the services:

```bash
pnpm dev               # ingest, scorer worker, discord bot (needs DISCORD_BOT_TOKEN)
pnpm ml:dev            # ML service on :8000
```

## Repo layout

```
apps/ingest        Fastify edge. Auth, schema validation, media refusal, PII minimization, retention sweep.
apps/scorer        The kernel. Detectors, pair trajectory, actor skew, fusion, tiers, evidence bundles, worker.
apps/discord-bot   First shipping surface. Role to age band, mod-channel alerts, report draft.
apps/review        Next.js reviewer queue. Phase 2, not built.
services/ml        Python FastAPI. PII/migration classifier, script index, stage classifier interface.
packages/schema    Canonical types, zod validators, lexicon, script corpus, normalizer, hashing, retention, language guard.
packages/sdk-ts    Customer SDK: send events, verify webhooks, refuse bytes client-side.
packages/audit     Hash-chained append-only log.
scripts/eval       The section 10 evaluation suite.
docs/              DESIGN.md (spec), PHASE1.md (status), design.html (rendered).
```

## Reading order

1. `CLAUDE.md` for the rules and the current phase.
2. `docs/DESIGN.md` sections 2, 5 and 6 for the constraints, the signal catalog and the scoring algorithm.
3. `apps/scorer/src/pair.ts` for how the signal catalog's false-positive traps become gates.
4. `scripts/eval/src/suite.ts` for what the numbers mean and what they do not.
