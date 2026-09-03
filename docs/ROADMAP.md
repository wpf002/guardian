# Roadmap

The build order comes from DESIGN.md section 11. This page tracks it: what each phase delivers, what is done, what research changed, and what is next. Every milestone is a commit on main.

Status legend: done, in progress, planned, blocked (with the blocker).

## Phase 1: kernel v0 and Discord bot

Goal: prove the signal catalog on real traffic and start the labeled set. Install on three friendly servers.

| Milestone | Status | Commit or note |
|---|---|---|
| Workspace, schema, lexicon, normalizer, audit chain | done | `3c7fa80` |
| Rule kernel: detectors, MinHash, pair trajectory, actor skew, fusion, tiers | done | `3c7fa80` |
| Ingest edge with media refusal and PII minimization | done | `3c7fa80` |
| Discord bot pipeline, alerts, report draft | done | `3c7fa80` |
| Customer SDK | done | `3c7fa80` |
| ML service with rule fallback and TS-identical MinHash | done | `3c7fa80` |
| Evaluation suite (section 10), quick mode under `pnpm test` | done | `3c7fa80` |
| Prisma-backed kernel, customer, audit and guild config stores | in progress | completion workflow |
| Scorer persists events and pair tiers | in progress | completion workflow |
| Discord slash commands: setup, role, trusted, timeout, exclude, status, export, verify | in progress | completion workflow |
| End-to-end test against live Postgres and Redis | in progress | completion workflow |
| Security and correctness review with adversarial verification | in progress | completion workflow |
| Roblox PII Classifier v2 weights behind the rule fallback | planned | needs the Hub weights and the Roblox benchmark run |
| Install on three friendly servers | blocked | needs a Discord application and a bot token |
| Discord message-content intent verification (above 100 servers) | planned | around week 10 |

## Research (September 2026)

A multi-agent sweep read the 27 source URLs, mapped competitors across the four surfaces, identified the academic and practitioner experts, audited competitor UX, verified the claims that drive product decisions, and produced a gap analysis and a UX brief. Full text: [RESEARCH.md](RESEARCH.md).

Results are folded into this roadmap below as they land.

### What the research changed

Pending the sweep. This section will list the corrections to DESIGN.md and the new items added to phases 2 to 5, each with its source.

## Phase 2: stage classifier and review queue

Goal: fine-tune on PANC and PJZC plus bot-collected labels, ship the Next.js reviewer, make fusion learned.

| Milestone | Status | Note |
|---|---|---|
| Guardian product theme: tokens, light and dark, contrast validated by script | in progress | `scripts/theme/build-theme.mjs` |
| Reviewer queue UI: case list, case detail, evidence timeline, decision panel | planned | design brief from the research sweep |
| Operator dashboard: queue health, reviewer minutes per 1,000 users, tier rates, retention, audit status | planned | |
| Guild setup UI for Discord owners | planned | mirrors the slash commands |
| Review decisions write `Review` rows and audit entries; T3 only from here | planned | |
| Stage classifier fine-tune and evaluation on the section 10 suite | planned | needs PANC access and a labeled modern set |
| Learned fusion over reviewer outcomes | planned | needs labels from the bot |

## Phase 3: platform SDK and reporting

Goal: the revenue product. Event schema SDKs, webhooks, retention jobs, NCMEC ESP registration with the first customer, CyberTipline client.

| Milestone | Status | Note |
|---|---|---|
| Python SDK matching `packages/sdk-ts` | planned | |
| Webhook delivery with retries and a dead-letter view | planned | |
| CyberTipline ESP API client, report from evidence bundle, one-year preservation timer | planned | needs a registered customer; the `cybertipline_reports` table exists |
| Processor agreement and retention program (DESIGN.md section 9) | planned | counsel |

## Phase 4: investigator triage

Goal: tip dedupe and clustering first, sex-ad monitor second. Only under a signed agreement naming a custodian and scope.

| Milestone | Status | Note |
|---|---|---|
| Partner agreement | blocked | needs one LE or NGO partner |
| Tip dedupe and clustering over CyberTipline exports the unit already holds | planned | |

## Phase 5: parent app

Goal: on-device scoring, overt, device-owner-authorized. Last, and only after counsel clears the consent posture.

| Milestone | Status | Note |
|---|---|---|
| On-device encoder small enough to run on a phone | planned | depends on phase 2 |
| Consent and notice posture, state by state | blocked | counsel |

## Standing constraints

These do not move between phases. They are CLAUDE.md rules 1 to 9 and are enforced by code where code can enforce them: media refusal at the edge, T3 only from a reviewer, the accusation guard over every string, per-customer salted hashing, retention on every row.
