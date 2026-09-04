# Roadmap

The build order comes from DESIGN.md section 11. This page tracks it: what each phase delivers, what is done, what research changed, and what is next. Every milestone is a commit on main.

Status legend: done, in progress, planned, blocked (with the blocker), decide (needs a call from Will).

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
| Prisma-backed kernel, customer, audit and guild config stores | done | `0f2404c` |
| Scorer persists events and pair tiers | done | `0f2404c` |
| Discord slash commands: setup, role, trusted, timeout, exclude, status, export, verify | done | `0f2404c` |
| End-to-end test against live Postgres and Redis | done | `0f2404c` |
| Adversarial security and correctness review, 12 findings fixed | done | `57ff698` |
| Roblox PII Classifier v2 wired to its exact input contract | planned | R1 below; the single load-bearing detector in phase 1 |
| Discord privileged-intent application | planned | R2 below; threshold moved to 10,000 reachable users on 2026-06-10 |
| Non-retrofittable schema fields | planned | R3 below; cheaper now than after the first customer |
| Fan-IN, two velocity windows, non-financial coercion class | planned | R4 below |
| Base-rate simulation on real traffic, model card | planned | R5 below |
| Install on three friendly servers | blocked | needs a Discord application and a bot token |

## Research (September 2026)

A 114-agent sweep read the 27 source URLs, mapped 282 competitors, experts, tools and datasets across ten areas, audited competitor UX, and adversarially verified the 24 claims that drive product decisions through three lenses each. Full text: [RESEARCH.md](RESEARCH.md). Of 24 claims, 6 were confirmed outright and 18 came back partially correct with a material correction. None survived unexamined.

### What the research changed

Six corrections to DESIGN.md, in order of how much they move the product.

| # | Correction | Where | What to do |
|---|---|---|---|
| 1 | **The trajectory lane is not empty.** DESIGN.md section 12 implies nobody analyses behaviour over time. Modulate ToxMod has shipped a GA longitudinal actor-level grooming risk category since August 2023, Roblox Sentinel ships per-actor skew, and Thorn Safer Predict scores "at the conversation level", which in a 1:1 DM is pair-scoped and has been resold through Hive since April 2026. | section 12, and any pitch | Never claim nobody scores the pair or watches over time. The defensible wedge is narrower: the **order** of stages carrying signal, which only exists in academic work. |
| 2 | **The private-search citation is wrong.** DESIGN.md section 2 row 5 cites *US v. Wilson* (9th Cir. 2021), which is about private-search scope. The government-agent authority is ***US v. Rosenow*** (9th Cir. 2022): 2258A(f) disclaims any search duty, so a provider searching of its own volition is not a state actor. The circuits split. | section 2 | Fix the citation. Record in the audit chain that every threshold and lexicon change originated with Guardian or the operator, never with a police request. |
| 3 | **Section 230 does not cover the tier output, and the reason is sharper than assumed.** 230(c)(2)(B) plus *Zango* protects the blocking function, but *Enigma II* (9th Cir. 2023) held a security vendor calling a competitor "malicious" to be an actionable statement of fact. *Commonwealth v. Meta* (Mass. SJC, April 2026) makes misleading safety claims independently actionable. | section 2, rule 5 | The accusation guard is the right control and it stays. Marketing copy needs the same pass as UI strings. |
| 4 | **Six age bands is already a moving target.** Roblox added a three-tier account grouping in June 2026; the Texas and California statutory signals are four brackets; the EU derogation (Reg. 2026/1881, in force 31 July 2026 to 3 April 2028) permits grooming detection in private messaging only with human confirmation before any report and only on risk factors such as age difference. | rule 9, schema | Bands stay, but they need confidence and provenance beside them. These are compliance evidence, not metadata. |
| 5 | **The parent-app risk is the wrong statute.** The exposure for a vendor is 18 USC 2512 and FTC stalkerware precedent, not vicarious consent, which is a parent's doctrine. PETS 2025 found 8 of 20 sideloaded parental-control apps matched stalkerware indicators. | section 8, phase 5 | The parent app must be architecturally incapable of covert use, not merely configured against it. |
| 6 | **The price gap is a capability cliff, not an absence of low prices.** Commodity moderation is cheap and self-serve (Hive text $0.50/1k, Sightengine $29/mo, Lasso $99/mo). Every CSE, grooming and CSAM text product is contact-sales. | section 12 | The claim is that nobody sells *this capability* self-serve, not that nobody sells cheaply. |

### Decisions needed from Will

| # | Decision | Why it cannot wait |
|---|---|---|
| D-1 | **Build the reviewer queue, or adopt ROOST Coop.** Coop 1.0 (June 2026, Apache-2.0) ships queues with SLA status, policy-bound actions, an audit log, appeals, and NCMEC CyberTipline submission, free and self-hosted. | It determines whether phase 2 as designed exists at all. Current default is to build, because Guardian's tier semantics, the T3-only-from-a-human rule and the hash-chained audit are the product; Coop is a candidate for the reporting half of phase 3. |
| D-2 | **Scope to the stranger and financial pattern, or build the known-contact path.** Thorn's June 2025 survey (n=1,200 youth) found 36% of sextortion victims knew the perpetrator offline; of those, 52% were current or former romantic partners, 54% of perpetrators were themselves minors, and threats were carried out 38% of the time versus 20% online-only. Not one of Guardian's decisive signals fires on that population. | Either scope it explicitly in the docs, or build it. Silence reads as a claim Guardian does not support. |
| D-3 | **Who reviews for a 40-person server.** Section 6.1 of the UX brief requires a second reviewer for T3; a 40-person customer has one moderator. Under both rules a small customer can never file a report, which is the exact segment the product targets. | A designated escalation path (a Guardian-side or partner reviewer pool) has its own 2258A shape and needs deciding before the reviewer UI ships. |

### Ordered next five (reconciled with the completeness critic)

| # | Item | Why here |
|---|---|---|
| R0 | Decide D-1 (build versus Coop) | Determines whether phases 2 and 3 exist as designed |
| R1 | Wire Roblox PII v2 to its exact input contract, adopt its 39,202-conversation evasion benchmark as the normalizer regression test | The single load-bearing detector in phase 1. The weights are Apache-2.0 and multilingual. Encoding the input as JSON instead of a `</s>`-joined string silently throws away the measured F1. |
| R2 | Read Discord's Developer Policy, then file the privileged-intent application | Gates the only shipping surface. The threshold moved on 2026-06-10 from 100 servers to 10,000 reachable users with a 90-day clock, which one large Roblox community crosses alone. Shares its retention-policy artifact with R5. |
| R3 | Non-retrofittable schema fields: age band confidence and provenance, statutory bracket, per-excerpt human-viewed flag, per-customer jurisdiction and legal basis, private versus public channel, AI Act provenance | Cheap now, a migration with live customer data later |
| R4 | Fan-IN inversion, two velocity windows, non-financial coercion class | Cheap arithmetic on features the kernel already extracts. Ordered progression is deliberately **not** in this ticket: the critic found it contested in the literature and currently carrying the whole differentiator. |
| R5 | Base-rate simulation, published model card, and an order-adherence eval on PANC and PJZ | The eval decides whether ordered progression is a real wedge before it is marketed as one |

### New signal work (from the case files)

| # | Signal | Source |
|---|---|---|
| S1 | **Fan-IN**: many distinct actors converging on one under-16 target in a short window. Guardian already computes fan-out; inverting the same graph is a day's work. | Greggy's Cult (EDNY, indicted Dec 2025): five defendants, one victim set, a year undetected |
| S2 | **Two velocity windows.** DESIGN.md uses a single 24h window. EOGP (Webster et al. 2012) splits hyper-sexualised offenders escalating in under 4h from intimacy-seeking offenders taking weeks. Thorn 2025: 30% of sextortion demands land within 24h of contact, so 70% do not. | A single window misses one population by construction |
| S3 | **Non-financial coercion.** 764, CVLT, Court and Greggy's Cult coerce self-harm, cutsigns and fansigns rather than money. FBI names it a Category 1 threat (191 arrests, 28 countries, 2020 to 2025) and Discord is the venue. Every sextortion heuristic in the catalog keys on payment. | No vendor models it |
| S4 | **Victim-side branch in the T2 action set**, plus a StopNCII and NCMEC Take It Down referral. Guardian's fan-out and threat-template detectors will tier minors; timing one out is the wrong action. | Patchin and Hinduja (n=5,568): perpetrators are disproportionately former victims |
| S5 | **Voice and video are a blind spot.** ToxMod ships a GA child-grooming risk category; Roblox Voice v3 publishes 61% recall at 1% FPR across 30 languages. | Greggy's Cult escalated in Discord video calls, entirely outside a text kernel. Phase 3 or later. |

## Phase 2: stage classifier and review queue

Goal: fine-tune on PANC and PJZC plus bot-collected labels, ship the Next.js reviewer, make fusion learned.

| Milestone | Status | Note |
|---|---|---|
| Guardian product theme: tokens, light and dark, 38 contrast pairs validated by script | done | `46c03a6`, `scripts/theme/build-theme.mjs` |
| Reviewer queue UI: case list, case detail, evidence timeline, decision panel | in progress | design brief in RESEARCH.md section 6 |
| Operator dashboard: queue health, reviewer minutes per 1,000 users, tier rates, retention, audit status | planned | |
| Guild setup UI for Discord owners | planned | mirrors the slash commands |
| Review decisions write `Review` rows and audit entries; T3 only from here | planned | |
| Text-native reviewer wellness controls | planned | UW 2025 clinical study found probable PTSD at 26% and recommends capping exposure at 2 to 4h/day. Blur and grayscale do nothing for a transcript queue. |
| Report status and outcome trail back to the reporter | planned | Australia's eSafety undertaking (Aug 2026) makes outcome notification binding for Roblox. Tickets vanishing into a black box was the core Schlep grievance. |
| Evidence record shaped as a superset of CyberTipline API fields | planned | Makes export a projection rather than a rewrite |
| Stage classifier fine-tune and evaluation | planned | SCoRL's best published turn-level precision is 0.475 at a 0.58% positive rate. That ratio, not a claim the classifier fails, is the honest argument for the trajectory gate. |
| Learned fusion over reviewer outcomes | planned | needs labels from the bot |

## Phase 3: platform SDK and reporting

Goal: the revenue product. Event schema SDKs, webhooks, retention jobs, NCMEC ESP registration with the first customer, CyberTipline client.

| Milestone | Status | Note |
|---|---|---|
| Python SDK matching `packages/sdk-ts` | planned | |
| Webhook delivery with retries and a dead-letter view | planned | |
| CyberTipline ESP API client, report from evidence bundle, one-year preservation timer | planned | needs a registered customer; the `cybertipline_reports` table exists |
| Report quality as the product | planned | NCMEC 2025: 21.3M reports, over 10% of industry reports lacked enough data to determine jurisdiction, worse than 2024, and NCMEC now names offending companies. A complete, deduped bundle with human-viewed provenance is a claim nobody else makes. |
| Independent audit export for regulators | planned | eSafety's Aug 2026 undertaking created a procurement category that did not exist before. The hash chain is the artifact that answers it. |
| Processor agreement and retention program | planned | counsel |
| UK Online Safety Act children's risk assessment | planned | Both an exposure and an unclaimed sales wedge. Role-derived Discord bands do not satisfy highly-effective age assurance. |

## Phase 4: investigator triage

Goal: tip dedupe and clustering first, sex-ad monitor second. Only under a signed agreement naming a custodian and scope.

| Milestone | Status | Note |
|---|---|---|
| Partner agreement | blocked | needs one LE or NGO partner |
| Tip dedupe and clustering over CyberTipline exports the unit already holds | planned | Stanford 2024 found near-identical reports produce opposite outcomes |

## Phase 5: parent app

Goal: on-device scoring, overt, device-owner-authorized. Last, and only after counsel clears the consent posture.

| Milestone | Status | Note |
|---|---|---|
| On-device encoder small enough to run on a phone | planned | depends on phase 2 |
| Architecturally incapable of covert use | planned | The vendor exposure is 18 USC 2512 and FTC stalkerware precedent, not vicarious consent |
| Consent and notice posture, state by state | blocked | counsel |

## Standing constraints

These do not move between phases. They are CLAUDE.md rules 1 to 9, enforced by code where code can enforce them: media refusal at the edge, T3 only from a reviewer, the accusation guard over every string, per-customer salted hashing, retention on every row.

Two the research sharpened:

- **No exposure feature, and alert copy that cannot be repurposed as one.** PredCord (about 1,569 members) and a 3,334-member "catching and exposing" server run predator-catch channels. Guardian's bot will be installed on servers whose members already do this. The mod-channel embed is publication to a third party; a volunteer moderator can screenshot it. Role-gated evidence and an operator terms clause forbidding redistribution are open work.
- **The alert card grammar carries documented harm.** GoGuardian Beacon is the most-copied product in the UX audit and the most criticised: its alerts have been reported to produce wrongful police welfare checks and to out LGBTQ students. The failure mechanism is identical to Guardian's mod-channel card, an untrained adult receiving a model-generated behavioural claim about a named minor with an action button attached. Copy the layout, not the phase model, and review before shipping.
