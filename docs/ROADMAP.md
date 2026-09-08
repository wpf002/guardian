# Roadmap

The build order comes from DESIGN.md section 11. This page tracks it: what each phase delivers, what is done, what research changed, and what is next. Every milestone is a commit on main.

**What is left to finish version 1 is [V1.md](V1.md), not this page.** This one is a log and it grows; that one is the plan and it shrinks. Read it first, and if an answer about what to do next disagrees with it, fix the page rather than the answer.

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
| Roblox PII Classifier v2 wired to its exact input contract | done | R1. Instruction prefix, t / s1 / s2 speaker tags, `</s>`-joined turns, 512 tokens with left truncation and the 0.60 / 0.55 / 0.10 thresholds, pinned byte for byte by a fixture. Weights need two env opt-ins, so nothing downloads at import or in a test. |
| Evasion benchmark as a normalizer regression gate | done | R1. 82 hand-written cases in `scripts/eval/src/pii-benchmark.ts`, per-category baselines, a category fails on a 15 point drop. Runs in `pnpm eval` as a non-required gate. |
| Three defects the evasion benchmark named | done | Dead emoji keys carrying U+FE0F, a platform name followed by any word reading as a handle, and short platform names invisible when spaced out. Lexicon `v3`; `v2` kept so older score rows reproduce. False positives on the hard negatives went 3 to 0, letter spacing 75% to 87.5%, overall recall 79.1% to 77.6%. The recall cost is recorded rather than the rule loosened; see MODEL-CARD.md. |
| Non-retrofittable schema fields | done | R3. Migrations `20260904102106_compliance_provenance_fields` and `20260904111509_pair_suggested_posture`. Age band confidence and provenance, derived statutory bracket, per-excerpt human-viewed flag, per-customer jurisdiction and legal basis, channel visibility, `soleAutomatedBasis`, feedback attribution, and the S4 posture on the pair. Every column nullable or defaulted. |
| Fan-IN, two velocity windows, non-financial coercion class | done | R4. S1 to S4 below. Fusion is now `rules-v2` and the default lexicon is `v2`. Nine findings from the adversarial review of that work are fixed on top of it; see the S1 to S4 rows. |
| Discord privileged-intent application | planned | R2 below; threshold moved to 10,000 reachable users on 2026-06-10 |
| Model card published with honest numbers | done | [MODEL-CARD.md](MODEL-CARD.md). Includes the PII evasion benchmark at 77.6% recall over 67 obfuscated handoffs with zero false positives, the three defects it named and how they were closed, and states plainly that generated evaluation traffic is a regression floor and not a production number. |
| Base-rate simulation on real traffic | blocked | Needs the bot installed. The gate runs on generated traffic today and the model card says so. |
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
| D-3 | ~~**Who reviews for a 40-person server.**~~ **Answered 2026-09-08: nobody.** A partition with one reviewer seat ends at the drafted bundle, and the operator files it themselves on the CyberTipline public form. Guardian records no tier nobody upheld. The two alternatives were Guardian staffing the second reviewer, which changes who is reporting and needs counsel, and a partner pool, which needs the LE or NGO partner phase 4 is already waiting on; neither was worth blocking v1 for, and either can replace this later without unpicking anything. `DecisionPanel` refuses the proposal below two seats and names the bundle as the path, and `filingReadiness` says the same thing on the report card. | closed |

### Ordered next five (reconciled with the completeness critic)

| # | Item | Why here |
|---|---|---|
| R0 | Decide D-1 (build versus Coop) | open. Determines whether phases 2 and 3 exist as designed |
| R1 | Wire Roblox PII v2 to its exact input contract, adopt an evasion benchmark as the normalizer regression test | **done**. The contract is pinned by a fixture and the benchmark runs in `pnpm eval`. The published F1 is quoted from the card, not reproduced: no weights were downloaded. |
| R2 | Read Discord's Developer Policy, then file the privileged-intent application | open. Gates the only shipping surface. The threshold moved on 2026-06-10 from 100 servers to 10,000 reachable users with a 90-day clock, which one large Roblox community crosses alone. Shares its retention-policy artifact with R5. |
| R3 | Non-retrofittable schema fields | **done**. Zod, Prisma and the migration are in step, and the ingest edge, the Discord mapping and the scorer's persist path now fill them. |
| R4 | Fan-IN inversion, two velocity windows, non-financial coercion class | **done**. Ordered progression was deliberately not in this ticket: the critic found it contested in the literature and currently carrying the whole differentiator. |
| R5 | Base-rate simulation, published model card, and an order-adherence eval on PANC and PJZ | **two of three done.** The base-rate simulation and the teen-romance control are required gates and pass; the model card is published with its uncomfortable numbers. The order-adherence eval measures the kernel against itself and found that permuting the stage order costs 54 points of T2 recall (F-8). Validating that against transcripts still needs PANC or PJZ. |

### New signal work (from the case files)

| # | Signal | Status | Source and note |
|---|---|---|---|
| S1 | **Fan-IN**: many distinct actors converging on one under-16 target in a short window. | done | Greggy's Cult (EDNY, indicted Dec 2025): five defendants, one victim set, a year undetected. Built as the inbound half of the existing graph, with three guards against the popular-streamer false positive: the receiver must be in a minor band, the converging accounts in older bands, and their messages must have carried a signal that survived gating at full strength. Guard 3 originally read any detector hit at all, computed before gating, which a giveaway offer or a handle swap satisfies; and the account being scored counted toward its own convergence, so a minimum of three sources really asked for two others. Both are fixed. It is a multiplier on the pair term only, so a busy account cannot be tiered for being busy. |
| S2 | **Two velocity windows**, 4h and 14d, with the original 24h retained and `velocityMode: "single"` reproducing the old behaviour exactly. | done | EOGP (Webster et al. 2012) splits hyper-sexualised offenders escalating in under 4h from intimacy-seeking offenders taking weeks. The same grooming ladder walked over two weeks still reaches T2 and names the window; the same teen romance stretched over three weeks still does not, and now lands no higher than the compressed version of itself. All three windows are read in one unit, stages per hour. They were not: the 14 day frame counted stages per day, and because `log1p` is not scale invariant the coarser unit outscored the hour frames for any span over about an hour, which made the 14 day term the velocity number for almost every pair at roughly ten times the DESIGN.md 6.2 calibration. A campaign now scores as a campaign. |
| S3 | **Non-financial coercion**, a `coercion_nonfinancial` detector in `CRITICAL_SIGNALS`, on nine phrase lists in `lexicon/v2.json`. | done | 764, CVLT, Court and Greggy's Cult coerce self-harm, cutsigns and fansigns rather than money. The control is what DESIGN.md 5 asks for on this row, a directed imperative, and no longer bare phrase presence minus an exemption. Three things changed after review. Exemptions are scoped to the clause the directive sits in, so four leading words ("are you ok? ") no longer veto a mark directive plus a proof demand in the next clause, and a support phrase elsewhere in the message no longer suppresses the class. A directive preceded in its own clause by a negation, by reported speech, by first-person narration or by an inquiry opener is a report of an instruction, not one: "please dont starve yourself" and "he told me to cut deeper and send proof" both used to force T2, the second one against the child disclosing it. And the marker nouns (cutsign, fansign) moved to their own list that needs a possessive qualifier or a compliance demand beside it, because "im going to the fansign event on saturday" is not a demand. Suppression lists are no longer customer-extendable: for an exemption, adding is blinding. Under-firing on a support conversation is still the correct error. |
| S4 | **Victim-side posture** on the fusion output, on `TierResult`, on the pair row, and read by the Discord bot. Plus a StopNCII and NCMEC Take It Down referral. | done | Patchin and Hinduja (n=5,568): perpetrators are disproportionately former victims. S3 tiers minors by design, and S4 is what stops that becoming a timeout, which is why the two had to ship together. That claim was not true when the row was first marked done: the posture was computed, written onto `TierResult`, and read by nobody, so a support-posture T2 still applied the timeout wherever the owner had run `/guardian timeout on`. `decideAction` now takes the posture and withholds the automatic timeout under support, `buildModAlert` carries the referral, and `pairs.suggestedPosture` persists it so the reviewer queue can see it. The alert still goes to the mod channel: a human still looks, they are just not handed an enforcement action against a child. The referral names no person and uses no pronouns, so it is safe to publish into a mod channel. |
| S5 | **Voice and video are a blind spot.** ToxMod ships a GA child-grooming risk category; Roblox Voice v3 publishes 61% recall at 1% FPR across 30 languages. | planned | Greggy's Cult escalated in Discord video calls, entirely outside a text kernel. Declared in the DESIGN.md section 5 catalog at weight "none" so it reads as a known false negative rather than an absence. Phase 3 or later. |

### Follow-ups opened by the R1, R3 and R4 work

Everything the four owners deliberately left out, plus what integration turned up. None of it blocks phase 1.

| # | Item | Owner surface | Why it is not done |
|---|---|---|---|
| F-1 | ~~Reviewer write path for `viewedByHuman`, `humanViewedAt` and `humanViewedByReviewerId`~~ | apps/review | **done** in phase 2. `markExcerptsViewed` returns the ids it wrote, appends an `evidence.read` chain entry, and stamps all three columns. `recordDecision` refuses a confirm or a proposal on a pair with no `humanViewedAt`. |
| F-2 | ~~Rate limit and anomaly check on the moderator feedback path, writing `feedbackSource: moderator`~~ | packages/schema | **done**. `packages/schema/src/candidates.ts` is the guarded write path into the lexicon mining loop, on its own subpath so the SDK never pulls it. A per-writer budget over a sliding window, a refusal for any proposal aimed at an exemption list (for an exemption, adding is blinding), a refusal for anything that normalizes to no letters or digits, and the writer's source on every row. `LexiconCandidate` rows are proposals: nothing promotes itself, because every score row names the lexicon version it ran under. |
| F-3 | ~~Normalizer misses: unreachable emoji keys, loose handle patterns, short compact needles~~ | packages/schema, apps/scorer | **done** in `768a84e`. Recorded in the model card, including the phonetic row that fell because the case was only ever passing through a broken rule. |
| F-4 | ~~Reversed-text pass in the normalizer~~ | packages/schema | **done**. `reversedReading` reverses a token when that token is a platform name backwards and is not one forwards, leaving the rest of the sentence alone, which is the shape the evasion takes. reversed_text 0.20 to 0.80, overall PII evasion recall 77.6% to 82.1%, hard negatives still 0 of 15. Puzzle encoding stays at 0: it needs a reasoning step a lexicon cannot provide. |
| F-5 | ~~DESIGN.md 6.2 still shows `velocity(stage_hits, window=24h)`~~ | docs | **done**. The pseudocode carries three windows, the fan-IN multiplier and the fused-score line, and states what the 2x transition bonus costs. |
| F-6 | ~~`docs/design.html` is a stale render, and CLAUDE.md names the benchmark dataset by its old alias~~ | docs | **done**. `pnpm docs` renders the HTML from DESIGN.md into the page's own stylesheet, `pnpm docs:check` fails when it is stale, and the alias note is in CLAUDE.md. The HTML is generated and is not edited. |
| F-7 | ~~End-to-end-encryption flag on the customer, and a `LexiconCandidate` table~~ | packages/schema | **done**. Both in the `20260905120000` migration. The flag reaches the console's `CustomerSettings`, and the candidate table is the mining loop's storage behind the F-2 guard. |
| F-8 | Order-adherence eval | scripts/eval | **half done, and the half that landed is the finding.** `stage order adherence` measures the kernel against itself: with the same messages permuted, T2 recall falls 100% to 46% while both arms still reach the late stages, so more than half of what puts a case in front of a reviewer is the ordering. Recorded as a baseline, in the model card, and in DESIGN.md 6.2. The external half needs PANC or PJZ, which are decoy transcripts Guardian does not hold, so ordered progression must not be marketed until it lands. |
| F-9 | ~~`velocityWindow` and the fan-IN summary are not persisted on the pair row~~ | apps/scorer, packages/schema | **done**. Both are columns now and both reach the case page. They are recomputable in principle and not in practice: the retention sweep deletes the events they were computed from before a reviewer opens the case. |
| F-10 | ~~Only `apps/scorer` and `packages/report` typecheck their own test files~~ | every workspace | **done**, and it found five real defects: a fetch mock typed as a zero-argument thunk while the test read its second argument, an audit export row narrowed to the wrong union member, two retention delegates missing `webhookDelivery`, and a discord.js emit argument typed as `Message` when the event narrows it. |
| F-11 | ~~No hard-negative class exercises the coercion detector~~ | scripts/eval | **done**. `coercion controls` is a required test with a fandom class and a self-harm-support class, both full of the vocabulary the detector keys on, plus a positive control so a detector broken closed fails here rather than passing quietly. The support class carries a disclosure of somebody else's instruction, which is the case that must never tier a child. |

## Two rule violations found by an adversarial review, 2026-09-05

Both were live. Neither was found by a test, because the tests asserted the
behaviour the code had.

**Rule 1: the byte guard could be walked past four ways.** The run-length
detector required 512 unbroken base64 characters, so `base64 photo.jpg` with its
default 76-column wrapping went through with a 202, and the scorer wrote the
image into Postgres for thirty days. So did base64url, whose `-` and `_` broke
every run at about sixteen characters. The data-URI patterns matched an
alternation over image, video, audio and octet-stream, which is a blocklist over
a label the sender chooses, so `data:font/woff2` was invisible; a `;charset=`
parameter before the base64 marker also defeated them. And the media-URL pattern
was anchored to the end of the string, so a link inside a sentence, which is
where links are, was missed.

The guard is a shape test now: separators are collapsed before the run is
measured, the alphabet covers base64url, any data URI carrying a payload is
bytes whatever it declares, and the URL match ends at a non-URL character. Audio
is media, which the rule's wording naming image and video did not make safe to
omit: a Discord voice message is an audio attachment.

**Rule 5: Guardian was naming a suspect.** `personOrUserReported` is displayed by
NCMEC as the suspect and was filled from `bundle.actorUid`. The actor is
whichever side the detectors scored, and ROADMAP S4 exists precisely because
those detectors fire on accounts in a minor band on purpose. Guardian would have
named a child as the suspect on a federal report.

A reviewer designates the account now and the builder refuses four ways without
it. The designation carries an axis into the envelope, because every other label
that distinguishes the two accounts was written on the actor axis and would have
inverted silently. The customer's identifiers moved from role-keyed to uid-keyed,
because role-keyed ones overrode the designation and made it decide nothing. And
the drafted bundle, which is the only path anybody will actually use in phase 1,
prints both accounts neutrally, names neither, and blocks filing until a person
says which one the report is about.

## Four findings still open from the rule sweep

Five of the nine are closed in `f37ed5e`'s follow-up. Three needed a decision
somebody had to make rather than a patch, and those decisions are recorded here
because each reverses something a comment in the code asked for.

**S-3, deletion beats the Restrict.** `Review.pair` was `onDelete: Restrict`
with the comment "a reviewer's decision is never removed by a pair expiring",
and the sweep therefore skipped any pair a reviewer had touched. Every decision
sets both `resolvedAt` and a review row, dismissal included, so a teen-romance
false positive dismissed on day two kept the child's quoted excerpts for ever
with an expiry in the past, while the console told the reviewer they were gone.
Rule 7 wins, and the reason it wins is that the decision does outlive the pair:
every review is on the hash chain, which is append-only, tamper-evident, and the
record a regulator would be shown. The mutable row was a copy. The Restrict
stays, because it still stops an accidental delete elsewhere; the sweep deletes
the reviews itself, in the same transaction, in batches of 500.

**S-5, the chain holds a digest of a note, not the note.** A reviewer's note
describes the conversation and usually quotes it, and the chain outlives every
retention class Guardian has. Storing the words there was rule 7 with no
exception written for it. The chain now records whether a note was written, how
long it was, and its sha256. A regulator checking that a stated reason was not
rewritten hashes the note off the review row and compares; nobody reading the
chain reads the child. The note itself stays on the review row, which retention
now deletes.

**S-1, a mod channel everyone can read is refused.** "post in a public channel"
was the third entry in `FORBIDDEN_ACTIONS` and nothing read the list, while
`/guardian setup` offered every text channel. The alert names two accounts,
pings them, and describes a grooming trajectory. The send now tests
`@everyone`'s ViewChannel on the resolved channel, which is the question the
rule is actually asking.

**S-4, rule 7 covers the queue.** The question was whether a Redis Stream
entry is a stored row. It is: a queued event is raw text Guardian is
holding, and which store it sits in does not change what it is. So the
sweep gained a step rather than the rule gaining an exception.

The MAXLEN on append was never a retention control, whatever the comment on
`RedisEventQueue` claimed. Redis Streams do not remove an entry when it is
acknowledged; XACK clears the pending list and the entry stays. Verified
against the running Redis: three entries, one acked, XLEN still three. So a
busy partition turned its text over in hours and a 40-person guild sending
fifty messages a day kept every one of them for as long as the deployment
lived, which is rule 7 with nothing written for it.

`RedisStreamRetention.trimBefore` runs as a `streams` step in the sweep, at
the same 24 hour cutoff the T0 text step uses, because it is the same rule
about the same words. MINID exact rather than `MINID ~`: the tilde stops at
a node boundary, which is the right trade for a size cap and the wrong one
for a deletion deadline. An entry nobody has consumed is trimmed with the
rest, which is the correct direction. An event unread for a day is a scorer
that has been down for a day, and holding a child's words to wait for it is
the thing the rule forbids.

**S-2, the band now records where it came from.** Both columns existed from
the September 4 migration and nothing but the dev seed ever wrote them, so
every real case would have read "provenance unknown" beside a band the case
page presents as the evidence for an age gap. `ActorState` carries
`bandProvenance` and `bandConfidence`, both call sites in the kernel apply
the event's reading, and `PrismaKernelStore` writes and hydrates the two
columns.

The part that needed deciding rather than typing is the ratchet. Bands
arrive on every message and a customer fills them in as an integration
matures, so under the old `preferKnown` the last non-UNKNOWN band won and a
role guess silently replaced a document. `resolveBandReading` orders the
seven sources and refuses a weaker one, and it moves the band and the
provenance together so a row can never claim a document said what a role
guess said. Equal strength is accepted, which is what lets a source correct
itself. An UNKNOWN band never replaces a known one.

The pair's cached bands went the same way. They had their own `preferKnown`,
and leaving it would have split the two: a customer sending a role guess
after a verified reading would downgrade the band the age gap is computed
from while the console kept showing the verified one off the actor row, so a
reviewer would see a gap the score never applied.

Still open, and why:

| | Finding | Why it is open |
|---|---|---|
| S-6 | A scoped audit export leaks a per-version census of the rows it withheld. | Rule 8, medium. A count of another customer's rows is not their content, and removing it costs a reader the ability to tell a redacted export from a short one. |
| S-9 | `modelTier` on a review row is documented as the tier the model assigned and is set from `pair.tier` at open time, which can be a reviewer's T3. | Unreachable through the lone-reviewer path now that a T3 pair refuses a plain decision, but the column still means two things. Renaming it is a migration. |

## What is open, and what is blocking it

Everything in phases 1 to 3 that needed nothing outside this repository is now
built. One thing is open that is not blocked on a person:

| | What | Why it matters |
|---|---|---|
| F-8, external half | Order-adherence against PANC or PJZ | Permuting the stage order costs 54 points of T2 recall. Until that is checked against transcripts, ordered progression is a design choice with a recorded cost, not a differentiator, and it must not be sold as one. Needs dataset access rather than code. |

Everything else that remains is waiting on somebody outside this repository:

| What | Waiting on |
|---|---|
| A first real guild | A Discord bot token, and an owner who wants it |
| Submitting a report rather than drafting one | NCMEC ESP registration, and the P-1 answer about a hash-only file record |
| Stage classifier, learned fusion | PANC and PJZC access, then labels from real reviewer decisions |
| Investigator triage (phase 4) | One signed LE or NGO partner |
| Processor agreement, retention program, UK OSA risk assessment, parent-app consent posture | Counsel |
| Voice and video (S5) | A partner model. Declared in the DESIGN.md section 5 catalog at weight "none" so it reads as a known false negative rather than an absence |

**The linter now runs.** It had never executed: there was no eslint config anywhere, so `pnpm lint` failed the same way in ten workspaces. A root flat config, type-aware over `src` and syntax-only elsewhere, plus the Next config the console already had. It found nine dead bindings, a dead phrase pool in the eval generators, eight literal invisible characters where escapes were meant, five promise-returning click handlers, and eleven `String()` calls over values that could be a `File` or an object.

## Phase 2: stage classifier and review queue

Goal: fine-tune on PANC and PJZC plus bot-collected labels, ship the Next.js reviewer, make fusion learned.

| Milestone | Status | Note |
|---|---|---|
| Guardian product theme: tokens, light and dark, contrast pairs validated by script | done | `46c03a6`, `scripts/theme/build-theme.mjs`. 62 required pairs after the console review, and `apps/review/src/styles/theme.test.ts` re-checks the shipped stylesheet. |
| Reviewer queue UI: case list, case detail, evidence timeline, decision panel | done | `/queue` and `/cases/[id]`. Confirm and propose-T3 stay disabled until an excerpt has actually been rendered to the reviewer, which is what sets the human-viewed flag. |
| Operator dashboard: queue health, tier rates, retention, audit status | done | `/dashboard`. Handling time is deliberately not shown per person and not compared between people. |
| Guild setup UI for Discord owners | done | `/guilds` and `/guilds/[guildId]`, mirroring the slash commands |
| Review decisions write `Review` rows and audit entries; T3 only from here | done | One code path, `src/lib/decisions.ts`. T3 needs a proposal plus a second reviewer. |
| Concurrence: a second reviewer answers a proposal in the console | done | `531a498`'s successor. `recordDecision` had taken a concurrence since phase 2 and no screen had ever supplied one, so the integration test was the only thing that had produced a T3. `Review` gains `state` and `parentReviewId`, the queue sorts an open proposal above everything and names who it waits on, and `ConcurrencePanel` upholds or overturns it. The second reviewer's read is checked against their own `evidence.read` chain entries: `Pair.humanViewedAt` is set by whoever read first and records nobody, so it was already satisfied by the proposer. |
| Text-native reviewer wellness controls | partly reverted | Threat language stays collapsed behind an explicit reveal, and nothing shows a per-reviewer speed or handling time. The session budget, the break prompts and the defer are removed (`a53bd7c`): they came from wellbeing research rather than from the spec, and the defer released nothing because a claim is not persisted. DESIGN-UI 11 is marked as a design note. |
| Adversarial review of the reviewer console, 35 findings fixed | done | Three lenses over the built app: design and accessibility, security, correctness. Summarised in the five rows below the table. |
| Report status and outcome trail back to the reporter | moved | Now a phase 3 row. It is the reporting half of the product and it needs the CyberTipline client underneath it. |
| Evidence record shaped as a superset of CyberTipline API fields | done | Delivered early, in phase 3, because `packages/report` needed it. `buildReport` is a projection rather than a rewrite. |
| Stage classifier fine-tune and evaluation | planned | SCoRL's best published turn-level precision is 0.475 at a 0.58% positive rate. That ratio, not a claim the classifier fails, is the honest argument for the trajectory gate. |
| Learned fusion over reviewer outcomes | planned | needs labels from the bot |

### What the console review changed

Every finding below was reproduced and then refuted before it was fixed, and each one carries a regression test where a test was practical.

| Area | What was wrong | What it is now |
|---|---|---|
| Tokens and contrast | `--text-subtle` never reached 4.5:1 on any surface in either theme and carried timeline timestamps, claim state and the "not reached" stage label. `--divider` at 1.4 to 1.7:1 was the only boundary on every input, button, chip and card. The dark accent failed on card surfaces and on the active nav item. The dialog backdrop was an opaque surface, identical to the page colour in dark. | The neutral text ramp moved a step in both themes and every text token is validated against `--bg`, `--surface` and `--surface-sunken`, not only against the page. `--border` is the resting boundary of a control at 3:1 and the new `--border-strong` carries hover, so `--divider` is a row hairline again. `--tier-t0-border` has its own value rather than aliasing the hairline. New `--scrim` token for the one overlay. The generator's required-pair table went from 19 pairs per theme to 31, and `apps/review/src/styles/theme.test.ts` re-checks the shipped stylesheet under `pnpm test`. |
| Accessibility | The first Tab on every page put the skip link into the shell grid and shattered the layout. Revealing a span or recording a decision dropped focus to `<body>` and announced nothing; the app's one live region was declared and never written. The reason list was an `aria-activedescendant` combobox with no combobox role, so arrowing through reasons was silent on the app's primary write path. The undo bar re-announced itself once a second for a minute. Normalized tokens were buttons with no handler. Every route shared one document title. | The skip link reveals in place without entering flow, and `<main>` takes focus. `lib/announce.ts` is the one writer of the live region, used by the reveal, the reveal-all and the decision. Focus anchors that do not unmount on the timeline row, the timeline heading and the confirmation region, with the undo bar as the first tab stop after it. Combobox roles on the reason filter, the countdown hidden from assistive technology, normalized tokens back to spans, and a title per route with a template. |
| Auth and exposure | Mock mode was inferred from a missing `DATABASE_URL` with no environment guard, which turns the whole console into an unauthenticated owner session; nothing on screen said so. `GET /api/login?token=` set the session cookie. Sessions carried role and customer for twelve hours with no roster re-check. The webhook test button was an unguarded request-forgery primitive with a status-code oracle. | Fixtures mode is never inferred in production and says so on every page when it is on. Sign-in is a same-origin POST only. The cookie proves identity and the roster supplies role and customer on every request. Webhook targets are checked as literals, after resolution, and again immediately before the request, sent with `redirect: "manual"`, and the outcome is delivered or not delivered with no status code and no transport error. |
| Evidence and the chain | A decision committed before its audit entry, so an append failure left a pair at a new tier with no chain entry and told the reviewer nothing had changed. The read flag that the private-search claim rests on was set optimistically by the browser, appended to no chain entry, and never checked server-side. Undo wrote a tier the client chose. Every decision restarted the retention clock, so a dismissal extended deletion by thirty days. | The Review row, the pair update and the chain entry are one transaction. `markExcerptsViewed` returns the ids it wrote, appends an `evidence.read` entry, and `recordDecision` refuses a confirm or a proposal on a pair with no `humanViewedAt`. Undo restores the `modelTier` on the review it compensates. The deletion clock moves only when the retention class escalates. |
| Operator numbers | Reviewer minutes per 1,000 users per day was a per-window total, so it read seven times its own label and failed a passing partition against the DESIGN.md section 10 mark. Realized T2 predictive value divided by every decision in the window. Tier rates ignored the window in fixtures and used `updatedAt` against a database. Score-to-decision latency measured against a timestamp the decision itself set, and the SLA deadline reset whenever anybody opened a case. | The minutes figure divides by the window. The predictive value counts only decisions on model-T2 pairs, and the printed n is that denominator. Tier rates use the tier-assignment time in both branches. Latency and the SLA both come from the pair's immutable arrival time. |


## Phase 3: platform SDK and reporting

Goal: the revenue product. Event schema SDKs, webhooks, retention jobs, NCMEC ESP registration with the first customer, CyberTipline client.

Full status: [PHASE3.md](PHASE3.md).

| Milestone | Status | Note |
|---|---|---|
| Python SDK matching `packages/sdk-ts` | done | `packages/sdk-py`. 57 pytest cases mirroring the TS suite, with the HMAC construction pinned from both sides by a literal hex so neither can drift alone. The media walk's cycle guard holds live references rather than `id()` values, which is what makes the two SDKs refuse the same payload. |
| Webhook delivery with retries and a dead-letter view | done | A durable row rather than one discarded fetch. Equal jitter, 8 attempts then dead, `FOR UPDATE SKIP LOCKED` drain worker, and a strict payload schema that refuses chat content at any depth. The scorer's `dispatch` now enqueues. Hardened after the adversarial review: redirects refused, the target rechecked immediately before every request, `Retry-After` floored at the schedule, settling fenced to the claim holder, and a claim error or an unreadable row no longer exits the process. |
| Evidence record shaped as a superset of CyberTipline API fields | done | Moved up from phase 2. Reporter of record, reviewer context, per-instant local time and offset, per-excerpt bands, and a 17-field completeness pre-flight, so `buildReport` is a projection rather than a re-entry. |
| CyberTipline ESP API client, report from evidence bundle, one-year preservation timer | done | `packages/report`. Five builder refusals after the adversarial review: anything but a reviewer-confirmed T3, a media row without a hash, a bundle and a customer that name different customers, byte-shaped free text anywhere in the envelope, and an accusation in a reviewer note. The client reaches production only on the exact literal `production`, and refuses a report belonging to a customer other than the one whose credentials it holds. Still needs a registered customer before a real submission, and the hash-only file record is unconfirmed (PHASE3.md). |
| Report quality as the product | done | The completeness scorer carries `jurisdictionDeterminable` as its own boolean, because it is the one number NCMEC publishes, and treats a salted-hash identifier as blocking rather than present. It also blocks a filing whose incident type is the fallback rather than something a signal or a reviewer chose, and the provider's jurisdiction and the legal basis now reach the submitted document instead of stopping at the envelope. |
| Independent audit export for regulators | done | `packages/audit/src/export.ts`. Self-contained artifact with the recomputation recipe, verified offline from the artifact plus the key, scoped per customer with rule 8 refusals and other customers' rows visibly withheld. An artifact where no row could be recomputed fails rather than passing, because the key is never used on that path. The dashboard export button is still open. |
| Webhook deliveries under the retention sweep | done | A `deliveries` step in `apps/ingest/src/retention-job.ts`. Rule 7 covers the new table. |
| Phase 3 end to end against live infrastructure | done | `scripts/integration/e2e.test.ts`. T2 to a second reviewer's concurrence to T3 through `apps/review/src/lib/decisions.ts`, then bundle, report, completeness, a bytes assertion, delivery backoff and an offline-verified audit export. |
| Report status and outcome trail back to the reporter | **done** | `getReportTrail` and a panel on the case, plus a reporting card on the dashboard. Everything on the trail comes from the hash chain or a stored row, so it cannot say something happened that the chain does not record. The last line is the point: NCMEC publishes no outcome back to the reporter, so the trail says where Guardian's knowledge ends rather than leaving a reader to assume somebody is still watching. That black box is the grievance that pushed civilian hunters into publishing instead of reporting. |
| Processor agreement and retention program | planned | counsel |
| UK Online Safety Act children's risk assessment | planned | Both an exposure and an unclaimed sales wedge. Role-derived Discord bands do not satisfy highly-effective age assurance. |

### Follow-ups opened by the phase 3 work

| # | Item | Owner surface | Why it is not done |
|---|---|---|---|
| P-1 | Confirm with NCMEC at ESP registration whether a hash-only `fileDetails` record is accepted | product | **blocked on NCMEC.** The API has no documented hash-only file route; the documented one is `/upload` with bytes. Guardian holds none (rule 1), so if the answer is no, the operator uploads from their own systems and Guardian's report names files by hash. |
| P-2 | ~~Customer columns for timezone, registered provider name, ESP id and named contact~~ | packages/schema | **done**. Plus the contact fields and the sealed-credential columns. `reportingIdentityFrom` is the one projection from the row to the bundle inputs, `bundleInputsFor` spreads it, and the bot reads it once at startup so a bundle records the identity in force when it was generated. |
| P-3 | ~~Per-customer encrypted NCMEC credential store~~ | packages/report | **done**. AES-256-GCM under a deployment key, with the customer id as authenticated data so a blob copied onto another customer's row does not open, and the key id on the row so a rotation reads as a rotation rather than as corruption. `espClientForCustomer` builds a client bound to one customer; the environment-variable pair stays for the single-customer case. |
| P-4 | ~~Idempotency key on a webhook delivery~~ | apps/ingest, packages/schema | **done**. Unique on `(customerId, kind, externalId)`, with the scored event's id as the key. Null stays distinct, so a caller with no id of its own keeps the behaviour it had. |
| P-5 | ~~Report creation ratchets the bundle to `CASE_1Y` with `expiresAt = preserveUntil` in one transaction~~ | packages/report | **done**. `recordSubmission` writes the report row and the bundle together, reading inside the transaction so the ratchet is a floor: a legal hold stays a hold and a later expiry stays later. |
| P-6 | ~~Decide whether the console shows the bundle-side or the report-side completeness~~ | apps/review | **done: the report side.** It is the question the person about to file is answering. The bundle's own score travels inside the bundle and inside the audit export, where the archive is read. Two scores on one card would only make a reviewer decide which to believe. `filingReadiness` never reports ready where the report scorer would block. |
| P-7 | ~~Dead-letter view and audit export button in the operator dashboard~~ | apps/review | **done**. A delivery card with the dead letters, the backlog and the sent-twice count, and a regulator export beside it. The export reads the chain and needs no key, which is why the action can run in a process that holds none. |
| P-8 | ~~Live-database test for `PrismaDeliveryStore.claimDue`~~ | apps/ingest | **done**. `scripts/integration/delivery-claim.test.ts`: two workers get disjoint sets, a fresh claim is handed to nobody twice, a stale claim is reclaimed and names its new holder, the limit holds, and the unique index dedupes a redelivered external id. |
| P-9 | ~~Reconcile `channelVisibility` in `evidenceTimelineRowSchema`~~ | packages/schema | **done**, by giving it a consumer. It reaches the console timeline, which labels anything that was not an open channel, and every excerpt on the drafted filing. |
| P-10 | ~~Add `.venv` and `.pytest_cache` to `skipDirs` in the accusation-guard source scan~~ | packages/schema | **done**, with `__pycache__`. |
| P-11 | ~~Surface the incident-type choice in the reviewer console~~ | apps/review | **done**. A selector on the report draft, a server action that rebuilds the draft under the choice and records it on the chain, and the draft prints the type and whether it was derived or chosen. Five of the eight types are reachable only this way. |
| P-12 | ~~Pin the checked address into the connection~~ | apps/ingest | **done**. `checkWebhookTarget` returns the addresses it passed on and `pinnedRequest` connects to one of them over `node:https`, with TLS still verified against the name. Nothing third-party sits on the path that carries a signed tier out of the deployment. |
| P-13 | ~~Show a dropped delivery result to the operator~~ | apps/review, apps/ingest | **done**. A dropped result is a POST the customer received that no row records, so the worker appends a `delivery.result_dropped` chain entry and the dashboard counts them as "sent twice". |

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
