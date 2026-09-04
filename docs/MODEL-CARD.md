# Guardian detection kernel: model card

Version: fusion `rules-v2`, lexicon `v3`, model `rules-v2`. Date: 4 September 2026.

ROOST's leadership named PhotoDNA, Thorn Safer and Google's Content Safety API as undocumented in April 2026. Only Roblox Voice v3 publishes an operating point. This document is the answer to that criticism for Guardian, and it costs nothing but honest numbers.

Read the limitations section before the numbers. The numbers are a regression floor, not a measurement of production performance, and the reason is in that section.

## What it does

Guardian scores an event stream for the documented predator playbook and returns a risk tier per (actor, target) pair and per actor.

| Input | Output |
|---|---|
| Text messages, who to whom, when, in what age band; media as a sha256 plus the operator's own scanner verdict | One of four tiers, the signals that fired, the fusion terms behind the score, and the version triple |

It does not identify people, assert that an offence occurred, or produce the top tier. `T3` comes only from a reviewer decision in `apps/review/src/lib/decisions.ts`, and the fusion layer is structurally incapable of returning it.

## Intended use

Small and mid-size platforms, Discord communities with a young user base, and their moderators and reviewers. The output is an input to a human decision, and every surface says so in those words.

## Out of scope

- Any decision taken without a human.
- Voice and video. Guardian is text-only. ToxMod ships a voice grooming category and Roblox Voice v3 publishes 61% recall at 1% FPR across 30 languages; Guardian covers none of that, and a case that escalates in a video call is invisible to it.
- Languages other than English. The lexicon is English. The Roblox PII classifier v2 covers 189 languages when its weights are loaded, but the rule layer around it does not.
- The known-contact population. Thorn's June 2025 survey found 36% of sextortion victims knew the perpetrator offline, and 54% of those perpetrators were themselves minors. Guardian's decisive signals (new account, catfish profile, threat template, off-platform migration) do not fire on that population. This is a scoping decision, recorded in the roadmap as an open question, not an oversight.

## How it works

Three scores fused by hand-tuned rules.

1. **Per-pair trajectory.** The ordered progression through the six stages, weighted so probe-to-migrate and sexualize-to-coerce count double; velocity over a fast (4h) and a slow (14d) window; asymmetry; the age gap; and economic signals.
2. **Per-actor skew and graph features.** Recency-weighted flagged-message density, fan-out to younger bands, fan-in from many older accounts, new-account burst, and alt clustering.
3. **Fusion.** Two structural rules, not thresholds: T2 requires either an ordered progression pattern or a critical signal, and the model cannot emit T3.

Critical signals (threat template, payment demand within an hour of inbound media, meetup logistics across an age gap, non-financial coercion, a known-CSAM verdict from the operator) force tier at least T2 regardless of score.

## Evaluation

Run `pnpm eval` to reproduce. Seed 42. The suite is `scripts/eval/`.

### Required gates

| Test | Result | Bar |
|---|---|---|
| Base-rate simulation | T2 precision 100%, 0 false positives across 6,500 benign pairs of which 2,500 are hard negatives | precision at or above 40%, FP rate at or below 0.2% |
| Teen-romance control | 0 of 2,000 same-band romantic conversations reached T2 | T2 rate at or below 0.1% |
| False-positive traps | 0 of 1,800 across six trap classes reached T2, while 73% to 97% of each class still fired a detector | none reach T2, and at least half exercise the gate |
| Audit chain tamper | verification failed and named row 23 | must fail and name the row |
| Model never emits T3 | 0 of 300 worst-case conversations | zero |

### Informational

| Test | Result |
|---|---|
| Early warning latency | median 5 messages to first T1, 100% of positives detected |
| Evasion red team | T2 recall 100% plain, 100% after emoji, leet and spacing rewrites |
| Sextortion script match | 100% recall on reworded scripts, 0 false positives in 100,000 benign strings |
| Actor fan-out | 60 minor-band contacts detected, contributing 2.01 to the actor score |

### PII and off-platform migration evasion benchmark

This is the only test that produces an uncomfortable number, which is why it is the most useful one here. 82 hand-written cases modelled on the categories in Roblox's published evasion benchmark. The previous column is the run before the three defects below were fixed.

| Category | Recall | Previous |
|---|---|---|
| Explicit handoff | 100% | 100% |
| Homoglyph substitution | 100% | 100% |
| Leet substitution | 100% | 100% |
| Split across turns | 100% | 100% |
| Pretextual | 100% | 100% |
| Letter spacing | 87.5% | 75% |
| Coded language | 71% | 71% |
| Phonetic | 50% | 67% |
| Reversed text | 20% | 20% |
| Puzzle or riddle encoding | 0% | 0% |
| **Overall** | **77.6%** over 67 obfuscated handoffs | 79.1% |

**0 of 15 hard negatives flagged, down from 3.**

The three defects this benchmark surfaced on its first run are fixed, in lexicon `v3` and in the detectors. `v2` is kept so a score row that references it stays reproducible.

- Emoji lexicon keys carrying U+FE0F were unreachable, so two entries were dead. The normalizer now strips presentation selectors and indexes the map by the selector-free key.
- A platform name followed by any word read as a handle. `v3` requires an explicit separator, an at-sign, or a token actually shaped like a handle.
- Short platform names were skipped in the compact form, so "kik" was invisible when spaced out. The floor is now three characters, with a word-boundary check against the original text doing the work the floor used to do.

Overall recall fell 1.5 points in the process, and that is the honest part of this table. The phonetic case that stopped passing was only ever passing because of the second defect: a platform name followed by any word counted as a handle. It was a true positive produced by a broken rule, and the same rule produced all three false positives. At a 0.01% base rate a false alarm costs a reviewer minute and there are far more benign conversations than real ones, so the trade is worth taking. The row is recorded down rather than the rule loosened to keep the number.

## Limitations, and what these numbers are not

**The evaluation conversations are generated, not collected.** Every public grooming dataset is decoy-based, English, and over a decade old, and none can be mirrored into this repo. The generators are built from the structures in the case files, and they draw on the same phrase families the lexicon holds. A high score here means the kernel has not regressed. It does not mean it will perform this way on real traffic, and reporting it as if it did would be exactly the failure the research criticised in other vendors.

**Base rates will wreck a naive reading of the precision number.** PAN-12 is 3% positive. Real platforms are closer to 0.01%. The published academic ceiling is instructive: SCoRL's best turn-level precision is 0.475 at a 0.58% positive rate. That ratio, not a claim that classifiers fail, is why T2 needs a progression pattern or a critical signal rather than a score threshold.

**The first honest precision number does not exist yet.** It comes from reviewer decisions on real traffic, which means the Discord bot has to be installed first. Until then production precision is a guess, and it is recorded here as a guess.

**The rule layer is not a model.** Phase 1 detection is rules over a versioned lexicon plus a MinHash script index. The Roblox PII classifier v2 is wired to its exact input contract but runs only when weights are explicitly enabled; the fallback is a rule and reports itself as one in `model_version`. The stage classifier is phase 2 and reports itself unloaded.

**Evasion is an arms race and this is a snapshot.** Puzzle encoding defeats the normalizer completely today. Reversed text mostly does.

## Fairness and harm

- **Adults who legitimately talk to minors.** Moderators, teachers and coaches produce high fan-out to younger bands by doing their jobs. The role whitelist damps their score rather than suppressing it, and in the trap suite that class reaches T1 (watch, no human asked to look) and never T2.
- **Teenagers.** Same-band romantic conversation is lawful. Age framing between two minors in the same band is damped to 15% of its weight, and the control asserts a T2 rate at or below 0.1%.
- **Children the detectors will tier.** Fan-out and threat-template detectors fire on minors, because perpetrators are disproportionately former victims. The kernel emits a support posture rather than an enforcement posture in that case, and the Discord bot will not time out an account it has marked for support.
- **Unknown age bands.** Everything is damped by 15% when either band is unknown, so missing data reduces confidence rather than being read as a default.

## Provenance and audit

Every score row records `model_version`, `lexicon_version` and `fusion_version`. Every score, reviewer action and export goes into a hash-chained append-only log whose verifier names the row that broke. An export is independently verifiable offline without Guardian's code, which is the artifact an independent effectiveness audit asks for.

## Reproducing

```bash
pnpm eval            # the full suite
pnpm eval:json       # machine readable
pnpm parity          # TypeScript and Python MinHash agree byte for byte
```
