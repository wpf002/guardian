# Guardian review console: UI design

The design for `apps/review`. Synthesised from the reviewer-first concept, with every graft the three judges flagged from the owner-first and operator-first runners-up folded in.

Read alongside `CLAUDE.md` (rules 1 to 9, which are legal constraints), `docs/DESIGN.md` sections 6.4, 7, 8 and 9, `docs/RESEARCH.md` sections 5 and 6, and `docs/ROADMAP.md` phase 2.

**Conflict rule.** Where two good ideas collide, the never-label rule wins, then reviewer wellness, then speed. That order is applied explicitly at the four places it mattered, and each one is marked.

---

## 1. Thesis

A trained reviewer clearing a T2 queue is not reading cases. They are separating one pattern from the thousand things that look like it, at hour two of a shift, on material about children. So the console is built backwards from the decision rather than forwards from the data.

Five commitments.

**The severity strip renders before the timeline is fetched, and is enough to decide on.** It streams from the pair row alone. A reviewer can dismiss, watch or defer having read nobody's words. This is the only wellness control in the set that reduces what a person actually reads rather than styling it.

**The reason chip is the submit.** Pressing `1` opens the dismiss reasons already focused; arrow and Enter commits. Two keystrokes, and the categorisation moment is the pause that a separate confirm dialog only pretends to be.

**The console is one surface.** Queue, case, evidence, context and decision live at one route. 84% of moderators leave the queue to gather context and every trip is a design failure, so the two known reasons for leaving (the operator's own tier policy, and prior decisions on this actor) are pinned in the case rail.

**Nothing anywhere measures a reviewer's speed, and that is architectural.** No per-reviewer pace value exists in any API response, so a leaderboard requires a new endpoint and a code review rather than a feature flag. A promise not to render a number is one refactor away from being broken. Minutes are captured because reviewer-minutes per 1,000 users is a DESIGN section 10 metric, and they are shown to the reviewer once, at the moment they can correct them.

**The exposure budget is the one hard limit, not the SLA.** When they conflict the SLA yields, and that is an operator-visible policy statement rather than a surprise.

Guardian's structural advantage over every product in the UX audit is that it holds no imagery. That removes the entire published wellness kit (blur, greyscale, mute) as an option, so every control here had to be invented for text. The text-native equivalent of blur is how little a reviewer has to read before they can act, which is a queue design problem rather than a filter.

### The four resolved conflicts

| # | Collision | Resolution | Rule that decided it |
|---|---|---|---|
| 1 | Bind the T3 attestation to actual reads, versus never putting exposure pressure on a reviewer at the worst moment | Neither a read quota nor an unbound claim. The attestation is **scoped to what was actually read**, the checkbox is disabled until at least one excerpt has been legibly rendered to this reviewer, and the bundle carries an honest completeness statement naming which excerpts a person read and which nobody did. A thinner honest bundle beats a fuller coerced one | Never-label first, then wellness. An attestation that a reviewer read material they provably did not is a perjurable line in a bundle that reaches NCMEC. A quota is the Sama shape with a legal justification stapled on. Scoping the claim satisfies both |
| 2 | The prohibitions belong on every case, versus a three-sentence block that never collapses is wallpaper by case forty | They are **consequence copy at the two moments they bite**: the confirm step, the propose step, and the read-only claimed-elsewhere view. Not a permanent panel | Wellness over completeness. Nagging that gets tuned out protects nobody |
| 3 | Bare `1` to `4` versus `Cmd-1` to `Cmd-4` | Bare digits primary, `Cmd`-modified aliases permanent, neither firing while focus is in a text field, the reason filter or an attestation input. A modifier is a tax paid two hundred times a shift, and the reason list sits between the keypress and the write | Speed, and only because wellness is unharmed: the pause moved into the reason list rather than disappearing |
| 4 | Making the reason chip the submit removed a confirmation step that was also a pause | The undo window grows from 5 seconds to **60 seconds**, as a persistent inline bar with the remaining seconds in text, never a toast that expires while the reviewer is reading | Wellness over speed. The undo has to be longer than the pause it replaced |

---

## 2. Personas and jobs

From RESEARCH 6.1. This app serves the second row. The first and third are served here only where they must be.

| Persona | Role in this app | The one job | Never asked to do |
|---|---|---|---|
| Trained reviewer | `reviewer` | Open the top case, read a stage-annotated timeline of at most 20 messages, record a decision plus a reason | Hunt for context in other tabs. Absorb explicit text they did not choose to reveal. Produce T3 alone |
| Second reviewer (same person, different seat) | `reviewer` | Form an independent view of a proposal, then uphold or overturn | See who proposed it before they decide |
| Trust and safety lead, or Discord server owner with a seat | `operator` | Set the tier policy the reviewers apply, add seats, see that reports are blocked and why, file the drafted bundle when there is no second seat | Read individual cases to understand system health. Judge whether someone is a predator |
| Guardian owner | `owner` | Everything an operator can do, plus the reason taxonomy and the wellness org defaults | |

Two constraints fall out of that table. The reviewer is in the app two hours a day and the operator twenty minutes a week, so the queue is the root and the operator surfaces are children of `/settings`. And the operator surface must never turn into a dashboard of people: aggregate copy is where pairs quietly turn back into people, and it gets its own lint case in section 10.

---

## 3. Information architecture

A 56px left rail holds three destinations for a reviewer, with the exposure meter pinned to its foot. Operator and owner see two more, each carrying a **state dot and never a count**, so navigation cannot become an alert feed. No top nav, no breadcrumbs, no settings dropdown. The rail is the only chrome.

| Route | Roles | What it is |
|---|---|---|
| `/` | all | Role-aware redirect. `reviewer` and `operator` land on `/queue`. No landing screen: a person opening Guardian is opening a queue |
| `/sign-in` | anonymous | Pre-SSO sign-in. Section 13 |
| `/queue` | reviewer, operator, owner | Ranked list with the ranking rule printed above it. Filters are chips |
| `/queue/[caseId]` | reviewer, operator, owner | The console. The list collapses to a 280px rail, the case fills the rest, the decision bar docks to the foot of the case pane. Opening claims the pair |
| `/queue/[caseId]/propose` | reviewer | Full-pane takeover for the T3 proposal. A route rather than a modal, because it is the only path to the one irreversible act in the app and it should be linkable, refreshable and visible as its own navigation |
| `/queue/[caseId]/file` | operator, owner | The D-3 branch. A reviewer-confirmed T2 plus a drafted bundle, and the seven-step walkthrough for filing at report.cybertip.org as the reporter of record. Section 8.6 |
| `/concurrence` | reviewer | The second-reviewer partition. Ranked oldest proposal first, because a proposal in flight is a case nobody owns |
| `/concurrence/[caseId]` | reviewer | Blind-to-identity concurrence view. Deliberately not the same screen as `/queue/[caseId]` |
| `/decisions` | reviewer | The reviewer's own log, this shift and 30 days. The only entrance to a reopen |
| `/decisions/[reviewId]` | reviewer, operator, owner | One decision, its reasons, its notes, its chain entries, and the reopen control |
| `/shift` | reviewer | Wellness and close-out. Also the interstitial served when the exposure budget hits 100%, so the stop lands somewhere useful |
| `/settings` | all | Per-reviewer reveal preference (one-way), the shortcut sheet, the reviewer's own rotation date |
| `/settings/people` | operator, owner | Seats, roles, rotation intervals, wellness org defaults, the escalation-pool connection |
| `/settings/policy` | operator, owner | The tier criteria text reviewers see pinned in the case rail, and custom reason labels. Every string here is checked by `assertNoAccusation` at write time and refused with the offending fragment quoted back |
| `/audit/[seq]` | all | One hash-chain entry, read only. Every provenance line in the app links here |
| `/help` | all | Tiers in plain words, what Guardian does not do, the keyboard sheet rendered from the keymap registry |

**Not in the IA, deliberately.** No cross-case search. No saved views beyond the filter chips. No notifications. No inbox. No stats page. No operations dashboard: that is a separate product for a person who visits twenty minutes a week, and building it first inverts who this app is for. Each of these is a reason to be somewhere other than a case.

### File layout

```
apps/review/src/
  app/
    page.tsx                          role-aware redirect
    sign-in/page.tsx
    queue/page.tsx
    queue/[caseId]/page.tsx
    queue/[caseId]/propose/page.tsx
    queue/[caseId]/file/page.tsx
    concurrence/page.tsx
    concurrence/[caseId]/page.tsx
    decisions/page.tsx
    decisions/[reviewId]/page.tsx
    shift/page.tsx
    settings/page.tsx
    settings/people/page.tsx
    settings/policy/page.tsx
    audit/[seq]/page.tsx
    help/page.tsx
  lib/
    copy.ts        every user-facing string, each through assertNoAccusation at
                   module load, so a bad string fails at import and not at render
    compose.ts     assertNoAccusation at the data boundary for any string built
                   from data, in the same call that returns it
    keys.ts        one keymap registry; the shortcut sheet renders from it
    session.ts     signed-cookie session, REVIEWERS env JSON. Section 13
  components/      section 4
  styles/          theme.css (generated), base.css
```

**The wording guard runs at the data boundary, not in a leaf component.** `assertNoAccusation` throws, and a throw inside a leaf React component is an error boundary and a blank screen for a reviewer mid-case, which is a worse failure than the string. Composition happens in the server component or serialiser; a string that fails renders as "This summary was withheld by the wording guard" with the case otherwise intact, and increments a counter visible to the owner in `/settings/policy`. A non-zero count is a defect somebody can act on, and it is the cheapest proof to counsel that rule 5 is enforced at runtime and not only in CI.

---

## 4. Component inventory

What the Foundation owner builds. Every component gets default, hover, focus-visible, active, disabled and loading states unless the row says otherwise, focus rings are the styled `--focus-ring` from `base.css` and are never removed, and no component contains a raw hex or px colour.

| Component | Purpose | Props | States |
|---|---|---|---|
| `AppShell` | The 56px rail, the content region, the skip link, the live region for polite announcements | `role`, `nav: NavItem[]`, `exposure?: ExposurePct`, `children` | default, rail-collapsed (under 900px), rail-as-bottom-bar (under 640px) |
| `NavItem` | One rail destination. Work items carry a count, oversight items carry a state dot and never a count | `href`, `label`, `icon`, `count?`, `dot?: "none" \| "attention"`, `active` | default, hover, focus-visible, active, current |
| `ExposureMeter` | Severity-weighted and reveal-weighted session exposure. Pinned to the rail foot and repeated on `/shift` | `percent`, `minutesLeft`, `tone: "normal" \| "elevated" \| "spent"` | default, elevated (at 60%), spent (at 100%), unknown (budget unreadable, queue fails closed), loading |
| `CaseCard` | One queue row. Three lines, never four. Section 6 | `pair`, `tier`, `criticalSignals`, `patternClause`, `bands`, `actorContext`, `slaRemaining`, `claim`, `unread`, `posture` | default, hover, focus-visible, active, unread, claimed-elsewhere (read only), loading skeleton at exact height. No disabled state |
| `TierBadge` | Tier as a word plus a border weight, never colour alone | `tier`, `variant: "bar" \| "inline"` | one static rendering per tier |
| `CriticalMarker` | Filled diamond plus the signal named in words | `signals: string[]` | present, absent (renders "critical: none") |
| `ClaimState` | Claim ownership and age, in words | `state: "unclaimed" \| "mine" \| "other"`, `who?`, `sinceMinutes?` | three renderings, plus loading |
| `SeverityStrip` | Server-rendered from the pair row before the bundle is fetched. Enough to dismiss, watch or defer on | `tier`, `criticalSignals`, `bands`, `messageCount`, `spanHours`, `mediaEvents`, `soleAutomatedBasis` | default, loading (renders labels and units immediately), error (never: the strip is the fallback for everything else) |
| `WhyPanel` | One behavioural sentence plus the three highest-contributing features as short bars, with nearest exemplars behind a disclosure for the skew term | `sentence`, `features: Feature[]`, `exemplars?`, `withheld?: boolean` | default, withheld (guard fired), loading, expanded |
| `StageStrip` | Six-cell pair stage vector, hit stages filled, transitions annotated with elapsed time, velocity window named beneath | `firstStageAt`, `velocityWindow` | default, empty (no stage reached), loading |
| `ActorPanel` | Other pairs in the window, fan-out, fan-in, account age, alt cluster, elevated role as a risk annotation, prior cases with outcomes inline | `actor`, `priorCases: PriorCase[]` | default, first-case, loading, partial (a count could not be read, named individually) |
| `PolicyPanel` | The operator's configured criteria for this tier, and when it was last edited and by whom | `tier`, `criteria`, `editedAt`, `editedBy` | default, unset ("your operator has not written criteria for this tier"), loading |
| `ProvenanceLine` | `model_version`, `lexicon_version`, `fusion_version`, score timestamp, chain link | `versions`, `scoredAt`, `auditSeq` | default, loading. The chain reference is a link to `/audit/[seq]` |
| `Timeline` | Two-party vertical thread, ordered by time, gaps as labelled spacers. Marked up as a list | `rows: TimelineRow[]`, `collapsePolicy`, `onReveal` | default, loading (labelled placeholder naming the message count), error, expired (excerpts deleted under retention), empty |
| `MessageRow` | Speaker tag, weekday and time, band word, text, stage annotation with calibrated confidence | `speaker: "t" \| "s1" \| "s2"`, `at`, `band`, `text \| collapsed`, `stage?`, `confidence?`, `lowConfidence?` | default, focused, revealed, third-party-collapsed |
| `CollapsedSpan` | A protected span rendered as its class and word count, never its content | `class`, `wordCount`, `revealed` | collapsed, hover-revealed, persisted-revealed, focus-revealed. Announces class and count, never content |
| `NormalizationReveal` | Normalized token inline and underlined; original on hover **and** on focus, with the lexicon entry, its version, and a false-positive control | `normalized`, `original`, `entry`, `lexiconVersion`, `onReportFalsePositive` | default, hover, focus, open, submitted |
| `MediaEventRow` | Direction in words, truncated hash, operator verdict, human-viewed flag as a full sentence, and the fourth line | `direction`, `sha256`, `verdict`, `viewedByOperatorHuman` | default only. No bytes, no placeholder, no aspect-ratio box, no filename |
| `TimeGap` | Labelled elapsed-time spacer | `hours` | default |
| `DecisionBar` | Four verbs plus two escapes, docked to the foot of the case pane, with consequence microcopy always visible | `caseId`, `disabledReasons: Partial<Record<Decision, string>>`, `onSubmit` | default, verb-hover, verb-focus, reason-list-open, submitting (chosen verb shows progress, others disable), write-failed, read-only |
| `ReasonList` | The submit. Opens focused, filterable by type-ahead, arrows move, Enter commits | `decision`, `reasons: Reason[]`, `onCommit` | open, filtering, empty-filter, committing, error |
| `NotePrompts` | Three prompts, never a blank box | `values`, `required: boolean`, `onChange` | default, required-unfilled, filled, disabled |
| `MinutesField` | Auto-timed, pausable, correctable before submit, with an interrupted checkbox | `minutes`, `interrupted`, `onCorrect` | default, editing, paused. Appears in no ranking or comparison anywhere |
| `UndoBar` | 60-second persistent inline bar with the remaining seconds in text | `secondsLeft`, `onUndo` | counting, undoing, expired (removes itself, does not collapse into a toast) |
| `ConsequenceCopy` | The three prohibitions, rendered at the confirm step, the propose step and the claimed-elsewhere view | `context: "confirm" \| "propose" \| "readonly"` | default, expanded ("Why?" opens one plain paragraph) |
| `AttestationBox` | A claim the reviewer makes about themselves, bound to evidence where a binding exists | `claim`, `bound?: { satisfied: boolean; reason: string }`, `checked` | unchecked, checked, disabled-with-reason-in-text (never a bare greyed box) |
| `CompletenessPanel` | What the bundle carries and what it does not, including which excerpts a person read and which nobody did | `present: string[]`, `missing: string[]`, `readCount`, `totalCount` | default, loading, all-present |
| `EmptyState` | Every empty view. Names the state, gives the last known good fact, offers one action | `title`, `detail`, `action?` | default only. No illustration, no celebration copy |
| `ErrorState` | Every failure. Names what failed, what is unaffected, and one manual retry | `title`, `unaffected`, `lastSuccessAt?`, `onRetry` | default, retrying. Never auto-retries |
| `SkeletonRows` | Loading placeholder at exact final height so nothing reflows | `count`, `height` | default. No shimmer, no spinner |

Type sizes used across the whole app: `--text-xs` 12, `--text-sm` 14, `--text-md` 16, `--text-lg` 20, `--text-2xl` 32. `--text-xl` is deliberately unused so the ramp stays at five. Weights: 400 body, 500 headings and tier words, 700 for the page title alone. One accent, on the primary action and the active nav item, nowhere else. Two elevation levels: `.surface` with a 1px boundary, and `--shadow-overlay` for the reveal-all confirmation and the undo bar. No `.surface-raised` in this app. The boundary token depends on what it separates: `--border` at rest and `--border-strong` on hover for anything a reviewer can act on (an input, an outlined button, a chip, a card that is a button, a dialog panel), because this app spends nothing on shadows and that 1px rule is the whole affordance, so it carries the 3:1 WCAG 1.4.11 minimum on every surface it can sit on. `--divider` stays what its name says, a hairline between rows inside one surface, and is never a control's only edge. A dialog dims the page behind it with `--scrim`, a translucent token, rather than covering it with a surface: an opaque backdrop the colour of the page reads as a navigation rather than a layer. Red is `--danger` only, reserved for retract and the one destructive confirmation, and never touches the tier scale.

---

## 5. Screens

### 5.1 `/queue`

**Purpose.** See what is waiting, why it is in that order, and get into the top case without touching the mouse. Most shifts a reviewer skips this screen by pressing Enter.

**Above the fold.** Partition name, count, live indicator, breach-risk count, session budget remaining. The ranking rule as one printed sentence. Five filter chips. The first four to six cards. Nothing else: no charts, no trend, no welcome.

```
┌────┬──────────────────────────────────────────────────────────────────────────────────┐
│ ▣  │  Queue · Northwood Gaming                                                        │
│Que │  14 in queue · live · 3 at breach risk · 47 min of session budget left           │
│ 14 │                                                                                  │
│ ▤  │  Ranked by tier and critical signal, times identifiable-victim signal, times     │
│Con │  actor fan-out, divided by SLA time remaining.          [ how ranking works ]    │
│ 2  │                                                                                  │
│    │  [ All 14 ]  [ Critical 3 ]  [ Unclaimed 9 ]  [ Breach risk 3 ]  [ Needs 2nd 2 ] │
│ ▥  │ ─────────────────────────────────────────────────────────────────────────────── │
│Dec │ ┃◆ T2   Pair 4f2a      critical: threat template match             unclaimed     │
│    │ ┃       Stage 3 to 4 in 19h · bands 16-17 to 9-12, role-derived                  │
│    │ ┃       actor in 3 pairs this week                              2h 41m left      │
│    │ ─────────────────────────────────────────────────────────────────────────────── │
│    │    T2   Pair 91c7      critical: none         claimed · A. Rivera, 4m ago        │
│    │         Migration ask with age gap · bands 18+ to 13-15, Discord teen status     │
│    │         first case for this actor                             3h 12m left        │
│    │ ─────────────────────────────────────────────────────────────────────────────── │
│    │    T2   Pair 0b3e      support posture suggested                  unclaimed      │
│    │         Coercion language, non-financial · both bands 13-15                      │
│    │         no enforcement action offered on this case             3h 40m left       │
│    │ ─────────────────────────────────────────────────────────────────────────────── │
│ ▓▓ │    T1   Pair aa19      critical: none                             unclaimed      │
│ ░░ │         Economic bait, single signal · bands unknown to 13-15                    │
│47m │         no progression                                        no SLA (watch)     │
└────┴──────────────────────────────────────────────────────────────────────────────────┘
```

The ranking rule is printed because a reviewer who cannot see why case A is above case B loses trust in the queue, and because it is also the answer to an auditor asking how work is prioritised.

**At 320px.** The rail becomes a 48px bottom bar with the three destinations and a 2px exposure strip along its top edge. The header drops the ranking sentence to a disclosure and keeps the counts. Cards keep all three lines; the tier bar moves from a 3px left border to a 2px top border so it survives the narrower measure. Filter chips scroll in their own `overflow-x` container and the page body never scrolls sideways.

**Empty.** "Nothing is waiting. The queue is live and will fill this row when something arrives." Plus the last-arrival timestamp, so a reviewer can tell empty from broken. No illustration and no congratulation: a quiet queue in this product is the absence of cases, not good news, and styling it as a reward trains people to want it empty.

**Empty because of a filter.** "No cases match these filters. 14 are in the queue. [ Clear filters ]". It always names the unfiltered count, so a filter is never mistaken for an empty queue.

**Loading.** Six card skeletons at exact card height, no shimmer, no spinner. The header count renders as soon as it is known and the cards fill under it.

**Error.** "The queue could not be reached. Cases are not lost; the scorer keeps writing. [ Try again ] Last successful load 14:02." Retry is manual. A queue that auto-retries and flickers between states is worse than one that has stopped and says so.

---

### 5.2 `/queue/[caseId]`, above the fold

**Purpose.** Decide. The strip is designed so a reviewer can dismiss, watch or defer without scrolling once.

```
┌────┬────────────────────┬─────────────────────────────────────────────────────────────┐
│ ▣  │ 14 queued · 3 risk │ Pair 4f2a · Northwood Gaming · #general        2h 41m left  │
│Que │ ────────────────── │ ┌─────────────────────────────────────────────────────────┐ │
│    │┃◆T2 4f2a   2h41  ▸ │ │ T2 review          ◆ threat template match              │ │
│ ▤  │┃Stage 3→4, 19h     │ │ Bands 16-17 → 9-12 · role-derived · confidence 0.42     │ │
│Con │ ────────────────── │ │ 14 messages · 19h span · 1 media event, verdict no match│ │
│ 2  │ T2 91c7    3h12    │ │ [ Defer, I need a buffer ]     [ Open the timeline  t ] │ │
│    │ claimed A. Rivera  │ └─────────────────────────────────────────────────────────┘ │
│ ▥  │ ────────────────── │                                                             │
│Dec │ T2 0b3e    3h40    │ Why this is here                                            │
│    │ support posture    │ An account in the 16-17 band asked who supervises the       │
│    │ ────────────────── │ younger account's phone, then asked to continue on another   │
│    │ T1 aa19      -     │ app 19 hours later. A threat-template match followed.       │
│    │ ────────────────── │                                                             │
│    │ T1 7d40      -     │   progression 3 to 4     0.38  ▓▓▓▓▓▓▓░░░░░░░               │
│    │ ────────────────── │   threat template        0.31  ▓▓▓▓▓▓░░░░░░░░   critical    │
│    │ T1 3c88      -     │   age-gap multiplier     0.18  ▓▓▓░░░░░░░░░░░               │
│    │                    │                          nearest exemplars ▾                │
│    │                    │ ┌ This pair ─────────────┐ ┌ This actor ──────────────────┐│
│    │                    │ │  1  2  3  4  5  6      │ │ 3 pairs, 7 days              ││
│    │                    │ │  ░  ▓  ▓  ▓  ░  ░      │ │ account age 11 days          ││
│    │                    │ │     └19h┘ └4h┘         │ │ fan-out 3 younger-band       ││
│    │                    │ │ trust · probe · migrate│ │ fan-in none                  ││
│    │                    │ │ velocity window: 4h    │ │ elevated role: none          ││
│    │                    │ │ actor score not sole   │ │ prior case: 1, dismissed as  ││
│    │                    │ │ basis for this tier    │ │   teen romance, 12 Aug       ││
│    │                    │ └────────────────────────┘ └──────────────────────────────┘│
│    │                    │ ┌ Policy for T2, set by your operator ───────────────────┐ │
│    │                    │ │ A progression pattern across two stages, or any one    │ │
│    │                    │ │ critical signal. Edited 22 Aug by M. Osei.             │ │
│    │                    │ └────────────────────────────────────────────────────────┘ │
│ ▓▓ │                    │ model rules-v2 · lexicon v2 · fusion rules-v2 · 09:14 UTC  │
│ ░░ ├────────────────────┤ audit #84117 →                                              │
│47m │ 5 unread below     │ 1 Dismiss  2 Watch  3 Confirm T2  4 Propose T3   ⌘Z undo   │
└────┴────────────────────┴─────────────────────────────────────────────────────────────┘
```

Three things on this screen are grafts, and each answers a documented failure.

**The policy panel** shows the operator's own configured criteria for this tier and when the lead last edited them. A reviewer is applying somebody else's policy, and being able to read it without leaving the case removes one of the 84% context trips rather than guessing at it.

**Elevated role prints as a risk annotation with a one-line explanation and never reduces anything.** The Castillo case is a developer with eighteen months of public reports; reputation is an anti-signal in most trust and safety systems and it was wrong there.

**Where `Pair.soleAutomatedBasis` is true** the strip says so in plain words and the propose action is blocked with the reason printed. Article 5(1)(d) of Regulation (EU) 2024/1689 prohibits assessing the likelihood of a person offending from profiling alone, and its carve-out is support for human assessment grounded in conversational facts. The schema already records whether there were any.

**At 320px.** The rail list is replaced entirely by the case; browser back returns to `/queue` and releases the claim after a confirm. The strip stacks its four lines and keeps both escapes as full-width 48px buttons. Why this is here keeps the sentence and drops the bars to numbers. Pair, actor and policy stack in that order. The decision bar becomes a sticky footer with the four verbs as a 2x2 grid at 44px minimum target, keyboard hints dropped.

**Not found.** "This case is not in your queue. It may have been decided, released or expired. [ Back to the queue ]"

**Loading.** The severity strip renders first from the pair row. The timeline shows a labelled placeholder, "Loading 14 messages", with the count known in advance so a reviewer can judge whether to wait.

**Error, strip loaded and timeline failed.** "The evidence timeline could not be loaded. You can defer this case or retry. Do not decide on the strip alone when the timeline is unavailable." Confirm and Propose disable with that reason printed beside them; Dismiss, Watch, Defer and Escalate stay live, because a person who cannot read the evidence can still honestly say "not sure" or "watch".

---

### 5.3 `/queue/[caseId]`, the evidence timeline

```
│ Evidence timeline · 14 messages · 2 third-party rows collapsed                        │
│ Collapse: explicit spans, threats, payment coercion       [ reveal all in this case ] │
│ ───────────────────────────────────────────────────────────────────────────────────── │
│  t   Tue 14:02  older band                                    stage 3 · 0.81          │
│      does anyone check your phone at night                                            │
│                                          supervision probe · lexicon v2 · flag        │
│                                                                                       │
│  s1  Tue 14:04  younger band                                                          │
│      no my mum works nights                                                           │
│                                                                                       │
│  t   Tue 14:06  older band                                    stage 4 · 0.77          │
│      add me on [snapchat]                                                             │
│                     ^ normalized from a ghost emoji · hover or focus for the original │
│                                          migration ask · lexicon v2 · flag            │
│ ─── 19 hours, no messages ─────────────────────────────────────────────────────────── │
│  t   Wed 09:11  media event      direction: older band to younger band                │
│      sha256:9f3c…a20b   ·   operator verdict: no match                                │
│      viewed by a person at the operator: no                                           │
│      Guardian holds no image and there is nothing here to open.                       │
│                                                                                       │
│  t   Wed 09:14  older band                              stage 6 · 0.66   ◆ critical   │
│      [ threat language, 22 words · reveal ]                        space to reveal    │
│                                                                                       │
│  s2  Wed 09:15  younger band                                  stage 2 · 0.31  low     │
│      [ 2 messages from 2 other authors in this channel · expand ]                     │
│ ───────────────────────────────────────────────────────────────────────────────────── │
│ Related · Notes                                                          3 collapsed  │
```

**Speaker tags are `t`, `s1`, `s2`**, the same convention the ML service puts on the wire, so a reviewer reads what the model read. Each row carries the tag, weekday and time, band word, the text, and a stage annotation in the right margin with the label and a calibrated confidence to two decimals. Never the raw logit. A stage label below the operator's precision threshold renders muted with a low-confidence tag rather than being hidden, so near-misses stay visible.

**Normalization is shown, not hidden.** The normalized token renders inline and underlined, and the original, the lexicon entry and its version are printed as visible text under the row. A reviewer who cannot see that `leVe` fired the migration signal cannot tell a true hit from a lexicon bug.

Until the popover exists, the token is a `<span>` rather than a control. A `<button>` with no behaviour is a dead tab stop per normalized token in the one view a reviewer traverses for hours, and a screen reader announces each one as activatable. When the popover is built it opens on click **and** on focus, carries the entry and version, and carries the control to report the token as a false positive, which writes into the mining loop with `feedbackSource: reviewer`. The visible note under the row stays either way: it is the path that works without a pointer.

**Media events** carry four lines. Direction in words, the truncated hash in mono with a copy control, the operator verdict, and the human-viewed flag as a full sentence rather than a boolean, because it is load-bearing legal metadata in the Second, Fourth and Ninth Circuits and a reviewer skimming a table of checkmarks will miss it. The fourth line, "Guardian holds no image and there is nothing here to open", stops a reader spending their minute hunting for a thumbnail and is CLAUDE.md rule 1 expressed as interface rather than policy.

**Redaction and reveal.** Spans classified as explicit sexual content, threat-template matches, non-financial coercion directives or payment coercion render collapsed as `[threat language, 22 words · reveal]`, revealed by hover, click to persist, and Space on focus, plus a per-case reveal-all in the header for anyone who cannot hover. Nothing softened is ever persisted: bundle, audit chain and export carry verbatim text, and paraphrase is a display layer with no write path.

**The collapse setting is a one-way ratchet.** The org default is set at `/settings/people` and moves downward only, toward more collapsing. A reviewer may turn collapsing **on** for themselves and never off. Per-case overrides do not exist. The AURA finding is that 35.8% of workers who could turn off video never did, and the ones who do are under pressure; a protection that a person can disable under load is not a protection.

**The `viewedByHuman` write path (ROADMAP F-1).** The flag is written true at the moment an excerpt is legibly rendered to *this* reviewer: an uncollapsed row in the viewport for longer than a second, or a collapsed span being revealed. Not on case open. Not by scrolling past a collapsed span. Reveal-all writes the flag on every span it opens, and says so before it opens them. It is a claim about a private search, not an engagement metric, and it has to be honest enough to survive a suppression motion.

Three things follow from that, and all three are server-side. The flag is written by the server against the pair's own current bundle under this customer, so the ids a client sends are matched rather than trusted. The write appends an `evidence.read` entry to the hash chain naming the reviewer, the time and the excerpts it covered, so the claim has a tamper-evident record behind it rather than two mutable columns, and it is the only reviewer act that was ever missing one. And the count that unblocks Confirm and Propose T3 is built only from ids the server confirmed it wrote: adding them optimistically meant a failed write still unblocked the two decisions that depend on the claim, and put a `viewedExcerptCount` on the Review row and in the chain entry that the bundle contradicted. The drafted bundle says what the record is, in those words: *recorded as read by a person at Guardian in the review console*, not a bare assertion the record cannot carry.

The server holds the same line at the decision. `recordDecision` refuses a confirm or a proposal on a pair with no `humanViewedAt`, whatever count the browser sends, because the browser's count is a claim and `humanViewedAt` is something the server watched happen.

### Deliberately not shown, anywhere in the case view

- No imagery. Not blurred, not greyed, not behind a click. There is no image code path to disable.
- **No link previews or unfurls, ever.** An unfurl is a fetch, and a fetch of a media URL is a rule 1 violation dressed as a convenience. URLs render as inert text with the host bolded.
- **No Discord jump links and no platform message ids.** A jump link is one click from the evidence view into the channel where someone can message the account.
- **No copy transcript, no export as image, no share, no print stylesheet.** The failure mode this product must design against is a correct decision followed by publication outside the app, and every export affordance is raw material for it.
- No avatars, display names or server nicknames at any size. Hashed handles at body weight only.
- No fused score as a headline, no percentage on the strip, no "risk 92".
- No composite wellness or trust score with invisible components.
- No raw logits.
- No messages from the actor's other pairs. Counts, tiers and outcomes only. Reading a second pair is a second case with its own retention class.
- No predicted next stage, no "likely to escalate". The model tops out at describing what happened.
- No screenshots of anybody's screen, which is the evidence unit of four products in the UX audit.
- No location, IP, device or platform metadata. None of it changes the decision and all of it is a doxxing input.

**Timeline empty because of retention.** "The excerpts for this case were deleted under the T0 retention rule on 14 Aug. The features and the tier remain." An expired case is a normal outcome, not an error, and it deserves designed copy.

---

### 5.4 `/queue/[caseId]/propose`

**Purpose.** Make proposing T3 feel like the statutory act it is, without making it feel like an accusation.

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  ← back to the case                                          Pair 4f2a · propose T3  │
│ ──────────────────────────────────────────────────────────────────────────────────── │
│  This proposes a report. It does not create one, and it does not create tier T3.     │
│  A second reviewer sees your reasons and your notes, and only their concurrence      │
│  writes T3. Disagreement writes a QA event and returns the case to T2.               │
│                                                                                      │
│  Before you send this                                                                │
│   Do not message either account about this case.                                     │
│   Do not post this, or a screenshot of it, anywhere, including a private mod         │
│   channel.                                                                           │
│   This goes to NCMEC, not to the police. Guardian drafts it.            Why? ▾       │
│                                                                                      │
│  Incident type                                                                       │
│  (•) Online enticement of a child for sexual acts        from your confirm reason    │
│  ( ) Child sex trafficking                                                           │
│  ( ) Unsolicited obscene material sent to a child                                    │
│  ( ) Child sexual molestation                                                        │
│  ( ) Child pornography · operator hash verdict, the operator is the viewer           │
│  [ ] Sextortion pattern present     [ ] Imminent danger  → reason required           │
│                                                                                      │
│  What in the timeline supports this                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Supervision probe at 14:02, migration ask at 14:06, threat template at 09:14.  │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
│  What context you gathered outside the timeline                                       │
│  ┌────────────────────────────────────────────────────────────────────────────────┐  │
│  What you are recommending the operator do        carried into the report            │
│  ┌────────────────────────────────────────────────────────────────────────────────┐  │
│                                                                                      │
│  Bundle completeness                                                                 │
│  present   14 excerpts verbatim · timestamps with timezone · jurisdiction ·          │
│            versions · audit chain ref · your identity and decision timestamp         │
│  read      11 of 14 excerpts were read by you. 3 were not read by anyone, and the    │
│            bundle says so.                                                           │
│  missing   operator human-viewed flag on 1 media hash   → request from operator      │
│                                                                                      │
│  Your claims                                                                         │
│  [x] I read the excerpts marked as read above, and I am not claiming to have read    │
│      the others.                                                                     │
│  [ ] This decision is mine and was not made at the direction of a law enforcement    │
│      request.                                                                        │
│                                                                                      │
│  Minutes on this case  17  [ correct ]   [ ] this was interrupted                    │
│                                                                                      │
│  Type PROPOSE to confirm:  [__________]                                              │
│  [ Send to a second reviewer ]                       [ Cancel, stay at confirm T2 ]  │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**The read claim is scoped and bound, and there is no read quota.** This is resolved conflict 1. The checkbox is disabled with the reason in text until at least one excerpt has been legibly rendered to this reviewer, and its wording claims only what the `viewedByHuman` writes support. There is no minimum read set, because requiring one puts exposure pressure on a person at the exact moment they are least able to refuse it. The bundle carries the honest completeness statement instead, and a thinner honest bundle survives a suppression motion where a fuller coerced one does not.

**The change-origin attestation** records that this decision was reached by this reviewer and not at the direction of a law enforcement request. It is the cheapest line in the product and the one that keeps Guardian out of the government-agent argument (US v. Rosenow, 9th Cir. 2022; RESEARCH 5.4 D7). The same attestation is required on every threshold and lexicon change.

**Not the operator's flag.** A Guardian reviewer never sets the operator's human-viewed flag. A manually asserted claim about a third party's conduct, made by someone with no knowledge of it, is what a suppression motion eats. The missing flag is a request to the operator, and until it arrives the bundle says it is missing.

**Typing PROPOSE** is the cheapest friction that cannot be muscle-memoried past, and it is honest about what it is asking.

**At 320px.** Same order, stacked. Incident type becomes a native single-select. The completeness block collapses to the present and read counts plus an expandable missing list, since missing is the actionable half. The typed attestation stays: shortening it on mobile would be shortening the friction.

**Disabled.** Propose is blocked outright when `soleAutomatedBasis` is true, when the timeline failed to load, and when no excerpt has been read. Each prints its reason beside the control, never as a bare greyed button.

---

### 5.5 `/concurrence/[caseId]`

**Purpose.** Let the second reviewer form an independent view before they see the first reviewer's, so concurrence means something.

```
┌────┬─────────────────────────────────────────────────────────────────────────────────┐
│ ▤  │ Pair 4f2a · proposed for report 11 minutes ago · you are the second reviewer     │
│Con ├─────────────────────────────────────────────────────────────────────────────────┤
│    │ Your concurrence writes tier T3 and starts a one-year preservation timer.        │
│    │ Overturning returns the case to T2 and writes a QA event. Neither is a finding   │
│    │ about a person.                                                                  │
│    │ ┌─────────────────────────────────────────────────────────────────────────────┐ │
│    │ │ T2 review          ◆ threat template match                                  │ │
│    │ │ Bands 16-17 → 9-12 · role-derived · confidence 0.42                         │ │
│    │ │ 14 messages · 19h span · 1 media event, verdict no match                    │ │
│    │ └─────────────────────────────────────────────────────────────────────────────┘ │
│    │ Why this is here     [same text the first reviewer read]                        │
│    │ Evidence timeline    [same, your own reveals, your own read flags]              │
│    │                                                                                 │
│    │ ▸ The first reviewer's incident type, reasons and notes            r to open    │
│    │   Their name is shown after you decide.                                         │
│    ├─────────────────────────────────────────────────────────────────────────────────┤
│    │ 1 Uphold, write T3    2 Overturn, return to T2, reason required   ⌘Z undo       │
└────┴─────────────────────────────────────────────────────────────────────────────────┘
```

The second reviewer is never the proposer, enforced server side. The first reviewer's reasons and notes are available before the decision, because the brief requires it; their **name** is withheld until after, which reduces anchoring and is the answer to "your second review was a rubber stamp". Uphold writes T3 and starts the preservation timer. Overturn requires a reason, returns the case to T2, writes a QA event, and both reviewers see the outcome in `/decisions`. The first reviewer may withdraw a proposal until it is decided.

**Empty.** "No proposals are waiting. Proposals arrive here from any reviewer on this partition, including you." If the partition has fewer than two active seats, the seat notice below renders anyway, because it is true at zero.

**Seat notice.** "Reports cannot complete in this queue. There is one active reviewer seat, and a T3 needs a second reviewer. The oldest proposal has been waiting 3 days. [ Add a seat ] [ File it yourself ]" This surfaces as a **staffing class with the oldest proposal's age, addressed to whoever can add a seat, and never as a reviewer's backlog**. Only the lead can fix it.

**At 320px.** Identical stacking to the case view. The disclosure stays closed and full width. The two decisions stack as 48px buttons rather than a grid, because there are only two and stacking removes any chance of a mis-tap between them.

---

### 5.6 `/decisions`

**Purpose.** The reviewer's own record, and the only entrance to a reopen. Not a performance view.

```
┌────┬─────────────────────────────────────────────────────────────────────────────────┐
│ ▥  │  Your decisions          [ this shift ]  [ last 30 days ]                       │
│Dec ├─────────────────────────────────────────────────────────────────────────────────┤
│    │  15:02  Pair 4f2a   T2 → proposed T3   online enticement                        │
│    │         with M. Osei for concurrence · 11 min                    [ withdraw ]   │
│    │ ─────────────────────────────────────────────────────────────────────────────── │
│    │  14:41  Pair 91c7   T2 → T2 confirmed  migration ask with age gap · 6 min       │
│    │                                                                 [ reopen ]      │
│    │ ─────────────────────────────────────────────────────────────────────────────── │
│    │  14:29  Pair 0b3e   T2 → T1 watch      one critical signal, no progression      │
│    │         support posture · referral shown to the operator · 4 min [ reopen ]     │
│    │ ─────────────────────────────────────────────────────────────────────────────── │
│    │  14:12  Pair aa19   T1 → T0 dismissed  teen romance, lawful, both bands 13+     │
│    │         2 min · excerpts scheduled for deletion 15:12 tomorrow                  │
│    │         Reopen available until the excerpts are deleted.        [ reopen ]      │
│    │ ─────────────────────────────────────────────────────────────────────────────── │
│    │  13:58  Pair 7d40   T1 → T0 dismissed  lexicon false positive: "leve"           │
│    │         token sent to the lexicon queue · 1 min                 [ reopen ]      │
│    │ ─────────────────────────────────────────────────────────────────────────────── │
│    │  This shift: 11 pairs decided, 2 sent to a second reviewer.                     │
└────┴─────────────────────────────────────────────────────────────────────────────────┘
```

**The summary line counts pairs, never people, never accounts, and never uses an adjective.** This is the aggregate-copy graft: "High-risk users this week: 12" passes `isAccusatory()` today and breaks rule 5 twice, a predicate adjective on people plus a list of people, which is also the rule 4 public-list prohibition. Every count string in this app and on `/shift` is written about pairs and actors and gets its own lint case.

**History is additive.** Decisions are never edited or deleted after the undo window. A reopen is a new row referencing the old one, the earlier decision shows inline and is not editable, and an overturn reads "Overturned on review", never "wrong", "mistake" or "error". The never-label discipline applies to the reviewer too, and a defence lawyer reading a mutated decision log gets a free cross-examination.

**The retention deadline is printed in plain words** on every reopenable row, so the retention clock is a visible property rather than a surprise. A T3 that has already been reported cannot be reopened here; the row links to the retraction path, which is a different act with a different consequence.

**At 320px.** Rows stack to three lines with the action as a full-width text button at the row's foot. The toggle becomes a two-option segmented control at full width.

**Empty.** "You have not decided anything this shift." with the 30-day toggle beside it.

**Error.** "Your decision log could not be loaded. Your decisions are recorded; this view is what failed."

---

### 5.7 `/shift`

**Purpose.** Make stopping a designed act rather than an interruption.

```
┌────┬─────────────────────────────────────────────────────────────────────────────────┐
│ ▣  │  Your shift                                                                     │
│Que ├─────────────────────────────────────────────────────────────────────────────────┤
│    │  Exposure           ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░   61%                   │
│ ▤  │  Weighted by what you revealed and the severity of it, not by case count.       │
│Con │                                                                                 │
│    │  T2 case time today        73 min of 120        Cases opened this hour  4 of 8  │
│ ▥  │  Next break                in 9 min             [ take it now ]                 │
│Dec │  Last critical-signal case 14:22, buffer taken                                   │
│    │  Rotation off the T2 queue  due in 3 weeks                                       │
│    │                                                                                 │
│    │  When your budget is spent, the queue stops serving new cases. It does not      │
│    │  log you out, and it never interrupts a case you have open. These are available:│
│    │    · 3 lexicon false-positive tokens waiting on a second opinion                │
│    │    · 2 dismissed cases from last week available for calibration review          │
│    │    · your decision log                                                          │
│    │                                                                                 │
│    │  Close out this shift                                                           │
│    │    2 cases still claimed by you   [ release both ]                              │
│    │    Anything you want to note for yourself                                       │
│    │    ┌───────────────────────────────────────────────────────────────────────┐    │
│    │    └───────────────────────────────────────────────────────────────────────┘    │
│    │    This box is yours. It is not sent to the operator and it is not in the       │
│    │    audit chain.                            [ end shift ]                        │
│ ▓▓ │                                                                                 │
│ ░░ │  Talk to someone: confidential counselling · peer reviewer channel · check-in    │
│47m │  The operator sees that you took a check-in. It never sees what you said.        │
└────┴─────────────────────────────────────────────────────────────────────────────────┘
```

**At 320px.** One column, meter first at full width. The lower-intensity list and the close-out become disclosures so the meter and the break control own the first screen. Support links stay pinned above the bottom bar and never behind a disclosure.

**Never empty.** At zero exposure it reads "You have not opened a case yet today."

**Loading.** The meter renders at its last known value in a muted state until fresh numbers land, rather than animating up from zero.

**Error.** If the budget cannot be read, the queue **fails closed**: it serves no new cases and says "Your session budget could not be read, so the queue is not serving new cases. [ Retry ]"

---

### 5.8 `/settings`, `/settings/people`, `/settings/policy`

`/settings` is per-reviewer and two screens' worth, deliberately: burying settings behind avatar navigation is in the do-not-copy list. It holds the reveal preference (which can only move toward more collapsing), the shortcut sheet rendered from the keymap registry, the reviewer's own rotation date, and nothing else.

`/settings/people` is the operator surface. Seats with role and rotation due date, the two-active-seats minimum stated in words as the condition for a completed T3, the escalation-pool connection, and the wellness org defaults with each row saying which direction a reviewer may move it.

```
│  Wellness defaults          org default        a reviewer may                    │
│   Session budget            120 min            lower it, not raise it            │
│   Cases opened per hour     8                  lower it, not raise it            │
│   Micro-break interval      25 min             shorten it, not lengthen it       │
│   Collapse protected spans  on                 turn it on, never off             │
│   Buffer after critical     90 s               fixed                             │
│   Rotation off the T2 queue 12 weeks           fixed                             │
│   Check-in participation    78%   You see participation. You never see what a    │
│                                   reviewer wrote.                                │
```

`/settings/policy` holds the tier criteria text that appears in the case rail, and any custom reason labels. **Every string an operator writes here passes `assertNoAccusation` at write time**, and a failure refuses the save with the offending fragment and the `instead` line quoted back. Every concept guards Guardian's own strings; this guards the strings customers add, which is the half that ships without review.

---

## 6. The case card

Three lines, never four. Line one is identity and routing, line two the pattern, line three time and actor context. Two type sizes (14px on line two, 12px on lines one and three), two weights (medium on the pattern clause and the tier word), and colour used exactly once.

| # | Field | Rendering | Why |
|---|---|---|---|
| 1 | Tier bar | 3px left border in `--tier-t*-border`, full height. Not a filled badge, and never a badge plus a second rule on the row | A wall of filled badges is the alarm styling the brief forbids. It binds every list of cases, not only this card, so two list surfaces cannot disagree about the same data. `--tier-t0-border` is `--border` rather than the hairline, so a T0 bar is as perceivable as the other three. At 320px it becomes a 2px top border |
| 2 | Critical marker | Filled diamond before the tier word when `criticalSignals` is non-empty, always with the signal named in words, and "critical: none" when it is empty | Never colour or shape alone. The absent case is stated rather than left to inference |
| 3 | Tier word | `T2`, medium, tabular | The word T2, not "high risk". A risk word is an adjective looking for a person |
| 4 | Pair id | Mono 12px, `Pair 4f2a` | The header names the pair, never the people. No display name, no avatar, no handle anywhere on the card |
| 5 | Posture chip | Text only, "support posture suggested", when `Pair.suggestedPosture` is `support`, with "no enforcement action offered on this case" on line three | It changes how the reviewer reads the whole case before they read any of it |
| 6 | Claim state | Right of line one. "unclaimed" muted, or "claimed · A. Rivera, 4m ago" | Enforced rather than advisory: opening a claimed case gives a read-only view with the consequence copy and a Request handoff control |
| 7 | Pattern clause | Line two, 14px medium. A noun phrase: "Stage 3 to 4 in 19h", "Migration ask with age gap", "Coercion language, non-financial" | Names the pattern, never a person, never a score |
| 8 | Bands and provenance | Line two, regular. "bands 16-17 to 9-12, role-derived" | The gap usually drives the rank, and the reviewer needs to know when it rests on a guess |
| 9 | Actor context | Line three. "actor in 3 pairs this week", "first case for this actor", or "fan-in: 4 accounts converged in 90 min" | The cheapest one-off versus pattern separator. A count, never a judgment |
| 10 | SLA remaining | Line three right, tabular, one-minute granularity, counted from the pair's arrival | Minutes and not seconds: a ticking second counter is a stopwatch, and the SLA is a queue property. Arrival and not last-touched: a deadline derived from an `@updatedAt` column resets every time somebody opens the case or the scorer rescores it, so a case can be pushed past its target by being looked at and the operator dashboard never shows a breach. T1 prints "no SLA (watch)" so the absence is a statement |
| 11 | Unread state | Light `--surface-sunken` fill plus a 1px `--border` outline on the whole card | Never colour; colour is spent on the tier scale |

**Deliberately not on the card:** the fused score, the actor skew value, any percentage, any avatar, any handle, any channel preview, any excerpt. A queue you can read without reading anybody's words is the point.

**States.** Hover raises the border to `--border` and nothing moves. Focus-visible draws the 2px `--focus-ring` at 2px offset around the whole card; the card is the tab stop, not its buttons. Active drops to `--surface-sunken`. Claimed-elsewhere renders with a dashed boundary and the claim line naming who holds it, stays focusable, and opens into the read-only view. Not an opacity: group opacity composites the whole subtree, so a child cannot opt back out of it, and the claim line, which is the one string telling a reviewer the case is read only, would be the least legible text on the card. Loading is a skeleton at the same three-line height, so the list never reflows. Disabled does not exist for a card: a card a reviewer cannot act on is read-only, which is a different thing and says so.

---

## 7. Case detail specification

The pattern goes above the fold and the raw text below it, because the reviewer's question is whether a pattern is present, not what was said.

**Order above the fold, and why that order.**

1. **Severity preview strip.** Server-rendered from `Pair` alone and streamed before the bundle is fetched. Tier word, critical signals in words, both bands with provenance and confidence to two decimals, message count, time span, media-event count with operator verdicts. Two controls live inside it: *Open the timeline*, and *Defer, I need a buffer*, which releases the claim without a decision, logs no reason and does not count as a skip. A reviewer can leave from here having read nothing, and a dismissal can cost zero exposure.
2. **Why this is here.** One sentence in the behaviour-not-person voice, generated from the fusion output and grammatically identical to the Discord card so the two surfaces read as one product. Under it, the three highest-contributing features with weights as short bars, the critical one marked in words. Where actor skew contributed, nearest-exemplar snippet labels sit behind a disclosure so "skew is rising" is inspectable rather than oracular.
3. **Pair and actor context, side by side.** Pair: the six-cell stage strip with hit stages filled, transitions annotated with elapsed time, the velocity window that fired named beneath, and the `soleAutomatedBasis` statement. Actor: other pairs in the window, fan-out, fan-in, account age, alt-cluster flag, elevated role as a risk annotation with its one-line explanation, prior Guardian cases with outcomes inline.
4. **Policy for this tier**, as the operator wrote it, with the last edit and its author.
5. **Provenance.** `model_version`, `lexicon_version`, `fusion_version`, score timestamp, and the chain reference as a link to `/audit/[seq]`. One 12px muted line. Small because the reviewer rarely needs it, present because an auditor and a defence motion both will.

**Below the fold.** The evidence timeline (section 5.3), then Related (prior cases on this actor with the earlier decision shown inline, counts and outcomes only) and Notes.

**Version banding, wherever a number moves.** Any tier-rate or PPV figure this app renders is cut at `model_version`, `lexicon_version` and `fusion_version` boundaries, never smoothed across one, and a movement after a version bump reads as a measurement change until a shadow run says otherwise. Below a stated n the figure renders "not enough decisions yet (n = 2)" rather than a value. Fusion has just moved to `rules-v2` and the lexicon to `v2`, so every number in the app is currently un-rebaselined.

---

## 8. The decision panel

Docked to the foot of the case pane, separated by a 1px rule and a shift to `--surface-sunken`. Not fixed to the viewport: at 1440 the case pane is the scroll container, and pinning to the window would float the decision over the rail.

```
  1  Dismiss        no further action, retention drops to T0 rules
  2  Watch          hold at T1, retain 30 days, raise priority on the pair
  3  Confirm        reviewer-confirmed T2, the operator's configured friction becomes
                    available
  4  Propose T3     opens the proposal. It does not create T3
  e  Escalate to a second reviewer without deciding
  c  Request context from the operator
  d  Defer, I need a buffer
```

Consequence microcopy sits under each verb, always visible, never on hover. *"Dismiss: the pair returns to normal scoring. It does not clear anyone of anything."* The words clear, cleared, exonerate, innocent and false alarm appear nowhere.

### 8.1 The reason chip is the submit

Pressing `1` does not dismiss the case; it opens the dismiss reason list, already focused and filterable by type-ahead. Arrows move, Enter submits the decision with that reason. One decision is two keystrokes and there is no separate confirm step, because a required reason arriving *after* the decision is a second dialog a reviewer learns to dismiss. Reasons are always required, on every decision including dismiss. A required-reason toggle is the wrong shape.

### 8.2 Notes and minutes

Notes are three prompts, never a blank box: *what in the timeline supports this*, *what context you gathered outside the timeline*, *what you are recommending the operator do*. The third survives into the report as the reviewer's context note, which is the field investigators most want and no schema captures. Optional on dismiss and watch, required on confirm and propose.

Minutes are auto-timed from case open, paused when the tab is hidden for more than 30 seconds, correctable before submit, with an explicit *this was interrupted* checkbox. They feed reviewer-minutes per 1,000 users. They appear in no per-reviewer display, ranking, comparison or pay input anywhere in the product, the number is shown to the reviewer only at the moment they can correct it, there is no running timer on the case, and **no per-reviewer pace value exists in any API response at all**.

### 8.3 Undo

`Cmd-Z` reverses the last decision for 60 seconds, rendered as a persistent inline bar with the remaining seconds in text rather than a toast that expires while the reviewer is reading. Undo emits a compensating audit entry and never mutates the original row. After the window, the path is reopen from `/decisions`.

Two things the window depends on. The confirmation and the bar stay mounted for the full sixty seconds even though the write has already resolved the case and the route has revalidated, or the reviewer gets a few seconds of a minute they were promised. And the tier an undo restores is the `modelTier` recorded on the review it compensates, never a value the caller supplies: a caller-chosen tier is a tier write with no decision and no score behind it, back in the queue with a four hour SLA and counted in the tier rates.

### 8.4 The confirm step

Confirm records a reviewer-confirmed T2. It is the decision most cases land on, so the consequence copy carries the three prohibitions here as well as on propose:

> Do not message either account about this case. Do not post this, or a screenshot of it, anywhere, including a private mod channel. If this needs reporting, it goes to NCMEC and Guardian drafts it, not to the police.

Each carries a "Why?" that expands one plain paragraph. They are here and on propose and on the read-only view, and nowhere else. The documented failure for this product is not a wrong decision inside the app; it is a correct decision followed by a screenshot into a catching channel, and the servers that do this are documented at 1,569 and 3,334 members.

### 8.5 The T3 confirmation step, and its audit consequences

`4` opens `/queue/[caseId]/propose`. Submitting writes **nothing to the tier**. It writes a proposal, moves the case to `/concurrence`, and changes the case header to "Proposed T3, awaiting a second reviewer".

What the propose submit writes to the chain, as one entry:

| Field | Value |
|---|---|
| `kind` | `review.proposed` |
| `pairId`, `customerId` | the case |
| `reviewerId`, `ts` | who and when |
| `incidentType` | the NCMEC incident type, preselected from the confirm reason |
| `reasonCode` | from the taxonomy in section 9 |
| `notes` | the three prompts |
| `readClaim` | `{ readCount, totalCount, excerptIds }`, from the actual `viewedByHuman` writes |
| `changeOrigin` | `{ origin: "guardian" \| "operator", lawEnforcementRequested: false }` |
| `versions` | model, lexicon, fusion |
| `soleAutomatedBasis` | copied from the pair, and false by precondition |

What concurrence writes:

- **Uphold** writes a second entry, `kind: "review.upheld"`, carrying the second reviewer's id and their own reason, sets `Review.resultTier = T3`, sets the bundle's retention to `CASE_1Y`, and starts the one-year preservation timer under 18 USC 2258A. This is the only path in the entire system that produces T3.
- **Overturn** writes `kind: "review.overturned"` with the second reviewer's required reason, returns the pair to T2, and writes a QA event. It never edits the first reviewer's row and its copy never says wrong or mistake.
- **Withdraw** by the proposer, before either, writes `kind: "review.withdrawn"` and returns the case to the first reviewer's confirm state.

Every one of these is additive. Nothing in this app edits or deletes a decision row after the undo window.

### 8.6 The one-seat branch (ROADMAP D-3)

A 40-person customer has one moderator and can never produce a second reviewer, which is the exact segment the product targets. The propose flow must not dead-end there, and Guardian must not fake a tier.

When a partition has fewer than two active seats, propose still submits, still ages, and surfaces on `/concurrence` as the staffing notice in section 5.5. Alongside it, `/queue/[caseId]/file` offers the branch:

> There is no second reviewer on this queue. Guardian records this as a reviewer-confirmed T2 with a drafted bundle, and you file it yourself at report.cybertip.org as the reporter of record. Guardian does not record T3 without two people, and it will not pretend to.

The route is the seven-step public-form walkthrough: Guardian's fields pre-filled and copyable, a persistent Quick Exit control, DHS's own preservation wording (save usernames and originals, do not alter, change or delete), the resource lines (NCMEC 1-800-THE-LOST, Know2Protect 1-833-591-5669, the National Human Trafficking Hotline for a trafficking-pattern bundle, NCMEC Take It Down for a sextortion target), a one-paragraph explanation of why this goes to NCMEC and not to local police, and **no path to attach media, export the bundle as an image, or post it anywhere**.

Rule 6 stays intact and the small customer stays unblocked. The measurement cost is real and belongs in the docs rather than the interface: Guardian's T3 count then honestly understates real reports, and the T3 PPV target of 90% is computed on the self-selected subset of customers with two seats.

### 8.7 Panel states

Hover raises each verb's border to `--border`. Focus-visible draws the ring around the verb; the reason list traps focus while open and returns it to the verb on Escape. Active depresses to `--surface-sunken`. Disabled applies to Propose under `soleAutomatedBasis`, to Confirm and Propose when the timeline failed to load or no excerpt has been read, and to every verb in the read-only view, always with the reason in text beside it and never as a bare greyed button. Loading applies for the duration of the write: the chosen verb shows an inline progress state, the other three go disabled, and the case does not advance until the write is acknowledged, so a failed write never looks like a completed decision.

**Write failure.** "The decision was not recorded. Nothing changed. [ Try again ]" with the reason, the notes and the minutes correction preserved in the form. A decision that may or may not have landed is the one error this app cannot ship.

---

## 9. Reason taxonomy

Required on every decision. The confirm and report sets map one to one onto CyberTipline incident types so export is a projection rather than a re-entry. Operator-added labels are permitted at `/settings/policy` and pass the wording guard at write time.

```ts
/** Why a reviewer decided what they decided. Stored as the code, displayed as
 *  the label. The code is the stable thing: labels get rewritten, and the
 *  fusion feedback and the calibration numbers have to stay comparable across
 *  a rewording. */
export const enum ReasonCode {
  // --- dismiss -----------------------------------------------------------
  /** Both accounts sit in the same band. The age gap that drove the rank is
   *  not there. */
  SAME_BAND_NO_GAP = "dismiss.same_band_no_gap",
  /** A relationship between two accounts both in 13+ bands with no gap that
   *  makes it unlawful. The teen-romance control in the eval suite exists
   *  because this is the largest false-positive class. */
  TEEN_ROMANCE_LAWFUL = "dismiss.teen_romance_lawful",
  /** An in-game economy exchange. Robux, skins, a giveaway. The economic-bait
   *  detector fires on the same vocabulary. */
  ECONOMY_TRANSACTION = "dismiss.economy_transaction",
  /** In-character content. Fiction, tabletop, collaborative writing. */
  ROLEPLAY_FICTION = "dismiss.roleplay_fiction",
  /** Both accounts sit in adult bands. */
  BOTH_ADULT_BAND = "dismiss.both_adult_band",
  /** One or both accounts are role-playing as a decoy or a catcher. A real
   *  false-positive source: the audit documents a 3,334-member server whose
   *  members do this, and Guardian's bot will be installed on servers whose
   *  members do this. */
  VIGILANTE_ROLEPLAY = "dismiss.vigilante_roleplay",
  /** A known relationship. Parent, guardian, sibling, a verified connection
   *  the operator can vouch for. */
  TRUSTED_CONNECTION = "dismiss.trusted_connection",
  /** A moderator or admin doing their job. Fan-out on a mod account is the
   *  job, not the signal. */
  STAFF_IN_ROLE = "dismiss.staff_in_role",
  /** The lexicon read a token wrong. Carries a free-text token field and
   *  writes into the mining loop with feedbackSource: reviewer. */
  LEXICON_FALSE_POSITIVE = "dismiss.lexicon_false_positive",
  /** The same conversation as another open case. Carries that case id. */
  DUPLICATE_OF = "dismiss.duplicate_of",

  // --- watch -------------------------------------------------------------
  /** One critical signal fired and nothing progressed. */
  ONE_SIGNAL_NO_PROGRESSION = "watch.one_signal_no_progression",
  /** The progression is there and the age gap rests on an unverified band. */
  PROGRESSION_GAP_UNCONFIRMED = "watch.progression_gap_unconfirmed",
  /** Too few messages in the window to tell. */
  INSUFFICIENT_CONTEXT = "watch.insufficient_context",
  /** Waiting on the operator to verify a band. */
  AWAITING_BAND_VERIFICATION = "watch.awaiting_band_verification",

  // --- confirm, reviewer-confirmed T2 -------------------------------------
  /** An ordered stage progression. Carries the from and to stage numbers. */
  PROGRESSION_PATTERN = "confirm.progression_pattern",
  /** A request to continue on another app, with an age gap. */
  MIGRATION_ASK_WITH_GAP = "confirm.migration_ask_with_gap",
  /** Money, goods or in-game currency offered across an age gap. */
  ECONOMIC_BAIT_ADULT_TO_MINOR = "confirm.economic_bait_adult_to_minor",
  /** Coercion without a payment demand: self-harm, marks, proof. */
  COERCION_NONFINANCIAL = "confirm.coercion_nonfinancial",
  /** The pattern is across pairs rather than inside one. */
  ACTOR_PATTERN_ACROSS_PAIRS = "confirm.actor_pattern_across_pairs",

  // --- propose T3, one to one with NCMEC incident types --------------------
  ONLINE_ENTICEMENT = "propose.online_enticement",
  CHILD_SEX_TRAFFICKING = "propose.child_sex_trafficking",
  UNSOLICITED_OBSCENE_MATERIAL = "propose.unsolicited_obscene_material",
  /** The operator's hash verdict. The operator is the viewer, never Guardian
   *  and never the reviewer. */
  CSAM_OPERATOR_VERDICT = "propose.csam_operator_verdict",
  CHILD_SEXUAL_MOLESTATION = "propose.child_sexual_molestation",
}

/** Two annotations rather than reasons, because either can sit alongside any
 *  propose reason. IMMINENT_DANGER requires a free-text reason string. */
export const enum ProposeAnnotation {
  SEXTORTION_PATTERN = "annotation.sextortion_pattern",
  IMMINENT_DANGER = "annotation.imminent_danger",
}
```

---

## 10. Wording rules

**The rule.** A tier describes traffic. A tier never describes a person. Every string, every log line, every API key name, every button label is written about a pair, a conversation, an account's messages or a signal, never about who someone is or what they intend. Prefer a noun phrase naming the pattern, or a verb phrase naming the action, over any predicate adjective attached to a human.

### Ten that pass

1. "Review suggested. 14 in queue, 3 at breach risk."
2. "Pair 4f2a: an account in the 16-17 band asked who supervises the younger account's phone, then asked to continue on another app 19 hours later."
3. "Age bands are role-derived and unverified. The gap driving this rank rests on an estimate."
4. "Dismiss: the pair returns to normal scoring. It does not clear anyone of anything."
5. "The model assigned tier T2. Only a reviewer and a second reviewer together can produce T3."
6. "Media event, older band to younger band. Hash held, no bytes. Operator verdict: no match. Viewed by a person at the operator: no. Guardian holds no image and there is nothing here to open."
7. "Normalized from a ghost emoji. Lexicon v2, entry migration.snapchat.emoji. Report this token as a false positive."
8. "This account holds an elevated role on the server. That is context for the reviewer, not a reason to lower the tier."
9. "This shift: 11 pairs decided, 2 sent to a second reviewer."
10. "You have 47 minutes of session budget left. The queue stops serving new cases at zero and offers lower-intensity work."

### Five that fail, and why

| String | Pattern tripped | Fix |
|---|---|---|
| "Grooming detected in this pair." | `FORBIDDEN_PATTERNS` entry 6: asserts the offence rather than the signal | "Signals consistent with stages 3 and 4 were recorded in this pair." |
| "This account is a groomer." | Entries 1 and 2. A hashed handle is still a person | "The older-band account sent two messages that matched the migration-ask lexicon." |
| "Reviewer-confirmed: known predator." | Entry 3. Even a human confirms a report, not a person | "Reviewer-confirmed: meets the criteria for an online enticement report." |
| "The second reviewer agreed the actor is guilty." | Entry 4. A legal conclusion Guardian has no standing to state | "The second reviewer upheld the proposal. Tier T3, and a report is drafted for the operator to file." |
| "You caught a predator today." | Entry 5. Vigilante framing and a scoreboard, which is the grammar the product must be unusable for | "You closed 11 pairs today. 2 went to a second reviewer." |

### Five that pass `isAccusatory()` today and must not

This is the highest-value graft in the set and it blocks the first string in this app. `FORBIDDEN_PATTERNS` is six regexes tuned for singular sentences about one account. Aggregate and plural copy is where pairs quietly turn back into people, and none of these is caught:

| String | What it breaks | Fix |
|---|---|---|
| "High-risk users this week: 12" | Rule 5 twice, a predicate adjective on people plus a list of people, and rule 4's public-list prohibition | "12 pairs at T2 this week, across 9 actors." |
| "Risk score: 92" | Presents a model output as a fact about a human | "Tier T2. Top contributing signals: progression 3 to 4, threat template." |
| "Watchlist" / "Flagged users list" | A list of people is the feature rule 4 forbids | "T1 watch, retained 30 days, scoped to a pair." |
| "Suspicious user" / "Bad actor" | Adjective and character judgment on a person | "Pair showing a progression pattern." / "actor, plus a tier." |
| A webhook key named `is_predator` or `threat_actor` | The rule applies to the API, not just the pixels | `tier`, `pair_id`, `signals[]`, `stage_vector` |

**Required before any string in this app ships.** Extend `FORBIDDEN_PATTERNS` in `packages/schema/src/language.ts` with the RESEARCH 6.7 left column: score-as-headline, watchlist, flagged users list, bad actor, suspicious user, caught / catch / nabbed / busted, rescue / raid / takedown, victim outside the NCMEC form field, and the webhook keys. The 6.7 deny list is 26 rows and the guard covers 6. It is a day of work.

### Enforcement

Every user-facing literal lives in `src/lib/copy.ts` and passes `assertNoAccusation` at module load, so a violating string throws at import rather than at render. Strings built from data (the Why sentence, the pattern clause, reason labels carrying free text, every count string) pass the guard at the data boundary in the same call that returns them, and a failure degrades to "This summary was withheld by the wording guard" with the case intact and a counter incremented. Operator-authored strings pass the guard at write time and are refused with the offending fragment quoted back.

---

## 11. Wellness controls, with exact limits

**Structural.** No imagery, and no image code path to disable. Every published wellness control in the market is an image control, so all of the following had to be invented for text.

| Control | Limit | Who may move it |
|---|---|---|
| Session budget, T2 case time | 120 min per reviewer per day | Org may lower, never raise. Reviewer may lower for themselves |
| Cases opened per hour | 8 | Org may lower. Reviewer may lower |
| Micro-break | Every 25 min, a full-pane interstitial requiring one keystroke to pass, never a toast | Org may shorten. Reviewer may shorten |
| Buffer after any critical-signal case | 90 s, skippable, with the next case **not pre-loaded** | Fixed |
| Rotation off the T2 queue | 12 weeks default, shown on the reviewer's own seat row and in `/settings` | Org sets the interval |
| Collapse of protected spans | On by default | One-way ratchet. Org default moves toward more collapsing only; a reviewer may turn it on for themselves and never off; no per-case override exists |
| Exposure meter | Severity-weighted and reveal-weighted, never case-count. Tone change at 60%. At 100% the queue stops serving new cases | Not configurable |
| Undo window | 60 s, persistent inline bar with the seconds in text | Fixed |

**What the 100% stop does and does not do.** It stops serving new cases. It does not log the reviewer out and it never interrupts an open case. The stop lands on `/shift`, which offers lower-intensity work: lexicon false positives awaiting a second opinion, calibration review of old dismissals, the decision log. A stop that dumps a person on a login screen is an interruption, not a protection.

**The exposure meter is weighted by what was revealed and how severe it was, not by case count.** A shift of ten strip-only dismissals costs less than one fully revealed critical case, which is true, and which is the first meter that matches the felt cost of a shift.

**Palette and motion.** No red anywhere on the tier scale; red is reserved for destructive irreversible actions so it means something when it appears. No pulsing unread dots, no animated counters, no progress rings, no sound, no auto-scroll. Motion is limited to 150 to 250 ms transform and opacity transitions, and reduced motion is the queue **default** rather than an accommodation.

**Separation.** The decision area is visually separated from the content area, so a reviewer's hands are never in the same visual region as the text they are reading.

**Confidential by construction.** Check-in results reach the reviewer; the operator sees participation and never content. The Ghana allegations, where personal disclosures circulated among managers, are why this is architectural rather than a policy line. Support and counselling links are one click from inside the case view, not an HR portal.

**End of shift** is a designed act on `/shift`, not a logout. It releases claimed cases explicitly rather than timing them out, offers a free-text note stored for the reviewer alone (not in the audit chain, not visible to the operator), and ends with the support links. Nobody should close a browser tab as the last act of a shift spent reading this.

**Nothing** in the product shows a per-reviewer speed, ranking, target or handling time, the case view shows no running timer, and no per-reviewer pace value exists in any API response.

---

## 12. Keyboard map

Every binding lives in `lib/keys.ts` and the shortcut sheet renders from that registry, so the sheet cannot drift from the behaviour. `?` opens it from anywhere.

**In the queue**

| Key | Action |
|---|---|
| `j` / `k` | Move selection down / up. Does not open, does not claim |
| `Enter` or `o` | Claim and open the selected case |
| `Shift+Enter` | Open read-only without claiming |
| `1` to `5` | Jump to filter chip |
| `/` | Focus the filter chips for type-ahead |

**In a case**

| Key | Action |
|---|---|
| `t` | Jump to the timeline |
| `g p` / `g a` / `g y` / `g v` | Go to pair context / actor context / policy / versions |
| `[` / `]` | Previous / next stage-annotated message row |
| `Space` | Reveal the focused collapsed span |
| `Shift+Space` | Reveal all spans in this case, after a confirm that says how many and that it writes read flags |
| `x` | Open the focused normalization or lexicon popover. `Esc` closes it |
| `d` | Defer, I need a buffer. Releases the claim, no reason, not a skip |
| `s` | Skip with a reason. Counts as a difficulty signal, and the queue says so |
| `e` | Escalate to a second reviewer without deciding |
| `c` | Request context from the operator |

**Deciding**

| Key | Action |
|---|---|
| `1` / `2` / `3` / `4` | Open the reason list for Dismiss / Watch / Confirm T2 / Propose T3. `Cmd`-modified aliases always work |
| type | Filter the reason list |
| `↑` / `↓` | Move within it |
| `Enter` | Submit the decision with the highlighted reason. This is the write |
| `Esc` | Close the list, return focus to the verb, decide nothing |
| `Cmd-Z` | Undo, for 60 seconds |
| `n` | Next case. Only available after a decision, a defer or a skip |

**Concurrence.** `r` opens the first reviewer's reasons and notes. `1` uphold, `2` overturn with a required reason. Same submit and undo semantics.

**Rules that hold everywhere.** No binding fires while focus is in a text field, the reason filter or an attestation input. `Esc` never navigates away from a claimed case. No shortcut fires an irreversible action without a focused step between the keypress and the write. Focus is always visible, including inside the timeline, and focus order follows reading order. Every hover-only reveal also opens on focus, and the per-case reveal-all is a real control rather than only a shortcut, or the collapse feature becomes a barrier rather than a protection. The SLA countdown never moves the user, never auto-releases a claim without a warning and an extension, and never blocks input.

**Screen reader semantics.** The timeline is a list; each row announces speaker, time and stage annotation once. Collapsed spans announce their class and word count, never their content. Queue count changes announce politely; individual new cases do not announce at all, because a queue that interrupts is a queue that gets muted. After a decision, focus lands on the confirmation region, then Tab reaches Undo first, and the confirmation stays on screen for the whole undo window even though the write has already resolved the case. It never lands on nothing. Revealing a span moves focus to the row body, which does not unmount, and says in the live region what class opened; reveal-all moves focus to the timeline heading, because the control that opened it has gone. The undo bar's seconds counter is hidden from assistive technology: inside a polite live region a ticking figure queues one announcement per second and drowns everything else for a minute.

---

## 13. Data: what each screen reads and writes

Mapped to `packages/schema/prisma/schema.prisma`. Anything the schema lacks is called out in 13.2 and needs a migration before that screen closes its loop.

### 13.1 Per screen

| Screen | Reads | Writes |
|---|---|---|
| `/queue` | `Pair` (`id`, `tier`, `criticalSignals`, `suggestedPosture`, `firstStageAt`, `signals`, `windowStart`, `windowEnd`, `messageCounts`, `updatedAt`, `soleAutomatedBasis`), `Actor` (`ageBand`, `ageBandConfidence`, `ageBandProvenance`, `fanOut7d`, `minorFanOut7d`, `role`), `Customer.name` | Nothing. A queue view is a read |
| `/queue/[caseId]`, strip and context | `Pair` (all of the above plus `pairScore`, `actorScore`, `fusedScore`, `modelVersion`, `lexiconVersion`, `fusionVersion`, `humanViewedAt`), `Actor` (both sides, plus `accountAgeHours`, `hints`, `graphState`), prior `Review` rows on this pair and on this actor's pairs, operator policy text | Claim on open. `Pair.humanViewedAt` on the first legible render |
| `/queue/[caseId]`, timeline | `EvidenceBundle` (`timeline`, `signals`, `provenance`, `modelVersion`, `lexiconVersion`, `fusionVersion`, `auditHead`, `humanViewedAt`, `humanViewedByReviewerId`), `Event.text` where the bundle is not yet generated and retention still holds it | Per-excerpt `viewedByHuman` inside `EvidenceBundle.timeline`, plus `humanViewedAt` and `humanViewedByReviewerId` on first read. A lexicon false-positive report with `feedbackSource: reviewer` |
| Decision panel | The above | `Review` (`pairId`, `reviewerId`, `decision`, `reason`, `modelTier`, `resultTier`, `minutesSpent`, `feedbackSource: reviewer`, `viewedExcerptCount`), `Pair.tier` and `Pair.resolvedAt` on dismiss / watch / confirm, `AuditEntry` for the decision, a compensating `AuditEntry` on undo |
| `/queue/[caseId]/propose` | Everything the case reads, plus the per-excerpt read counts | A proposal (see 13.2, gap 2), `AuditEntry kind: review.proposed` with the incident type, reason code, notes, read claim and change-origin attestation |
| `/concurrence/[caseId]` | The proposal, its `Review` row, the same bundle | On uphold: `Review.resultTier = T3`, `EvidenceBundle.retention = CASE_1Y`, `CyberTiplineReport` row at `status: "draft"` with `preserveUntil`, `AuditEntry kind: review.upheld`. On overturn: a new `Review` row referencing the proposal, `Pair.tier` back to T2, `AuditEntry kind: review.overturned` |
| `/queue/[caseId]/file` | `EvidenceBundle`, `Customer.jurisdictionCountry`, `jurisdictionSubdivision`, `legalBasis` | `CyberTiplineReport` with `ncmecReportId: null` and `reporterCustomerId` set to the customer, `AuditEntry kind: report.drafted_for_self_filing` |
| `/decisions` | `Review` by `reviewerId`, joined to `Pair` for the tier and the retention deadline | Nothing. Reopen writes a new `Review` referencing the old one |
| `/shift` | Session exposure (gap 4), claimed pairs, rotation date | Break taken, shift ended, claims released. The reviewer's own note is stored outside the audit chain |
| `/settings/policy` | Policy text and custom reason labels (gap 6) | Both, each through `assertNoAccusation` at write time, plus an `AuditEntry` carrying the change-origin attestation |
| `/audit/[seq]` | `AuditEntry` | Nothing |

### 13.2 What the schema lacks

Six gaps. The first three block the loop; the rest can follow.

1. **No claim state on `Pair`.** The queue shows claim ownership, opening claims, deferring releases, and `/shift` releases on close-out. Needs `claimedByReviewerId String?`, `claimedAt DateTime?`, `claimExpiresAt DateTime?` on `Pair`, and an index on `(customerId, claimedByReviewerId)`.

2. **No proposal state on `Review`, distinct from `resultTier`.** A proposal is not a T3 and must not be storable as one. `ReviewDecision` has `report` but nothing separates proposed from upheld from overturned from withdrawn. Needs a `ReviewState` enum (`recorded`, `proposed`, `upheld`, `overturned`, `withdrawn`) plus `parentReviewId String?` so a concurrence, an overturn and a reopen each reference the row they answer, without editing it.

3. **`Review.reason` is one nullable `String`.** The taxonomy in section 9 is a code plus optional operands (a token, a duplicate case id, from and to stages), and the notes are three fields rather than one. Needs `reasonCode String`, `reasonDetail Json?`, `noteTimeline String?`, `noteOutsideContext String?`, `noteRecommendation String?`, `incidentType String?`, `interrupted Boolean @default(false)`, and `changeOrigin Json?` for the attestation.

4. **No session or exposure storage anywhere.** The budget, the case-per-hour cap, break compliance and the severity-weighted meter have nothing to persist to. Needs a `ReviewerSession` model keyed on (reviewerId, day) holding weighted exposure, minutes, cases opened, breaks taken and the last critical-case timestamp. Keep it out of the audit chain: it is wellness state, not evidence, and putting it in the chain makes it discoverable.

5. **`velocityWindow` and the fan-in summary are not persisted on the pair row (ROADMAP F-9).** Every screen in this design prints both. F-9 asked what shape the reviewer queue wants them in, and this is the answer: `velocityWindow String?` as the window name, and `fanIn7d Int` plus `fanInWindowMinutes Int?` as integers on `Pair`. Recomputing them at render makes the case view depend on the scorer being reachable.

6. **No storage for operator policy text or custom reason labels.** `/settings/policy` and the case rail's policy panel both need it. A small `OperatorPolicy` model keyed on (customerId, tier) with `criteria String`, `editedAt`, `editedByReviewerId` is enough.

Two notes on things the schema already has and this design depends on. There is **no `Excerpt` model**: the per-excerpt `viewedByHuman` flags live inside `EvidenceBundle.timeline` as json, with `Review.viewedExcerptCount` as the count for the queue and `EvidenceBundle.humanViewedAt` / `humanViewedByReviewerId` as the anchors. And `LexiconCandidate` does not exist (F-7), so the false-positive control writes into the mining loop rather than a table, until it does.

---

## 14. Auth model

**Signed-cookie session, documented as pre-SSO.** This is a deliberate placeholder with a stated replacement, not an architecture.

A `REVIEWERS` environment variable holds a JSON array:

```json
[
  { "id": "rev_ar", "displayName": "A. Rivera", "role": "reviewer",
    "customerIds": ["cus_northwood"] },
  { "id": "rev_mo", "displayName": "M. Osei", "role": "operator",
    "customerIds": ["cus_northwood"] }
]
```

`/sign-in` takes an id and a shared secret, and sets an `HttpOnly`, `Secure`, `SameSite=Lax` cookie carrying `{ reviewerId, displayName, role, customerIds, issuedAt }` signed with an HMAC over a server-side key. Sessions expire after 12 hours and on end-of-shift. `lib/session.ts` is the only module that reads the cookie, and every route handler and server component gets the session from it rather than parsing headers.

**The cookie proves identity and nothing else.** Role and customer are re-resolved from the roster on every request, so removing a seat or demoting an owner takes effect on the next request. Trusting the role in the cookie body meant an offboarded seat kept its rights for up to twelve hours, and with no session table the only remedy was rotating the key and signing out everybody.

**Sign-in is a same-origin POST.** There is no GET that sets the cookie, and no seat token in a query string. A cookie-setting operation on an idempotent GET is reachable from any cross-site link or image, so a link carrying somebody else's seat token silently reseats whoever clicks it and their decisions land in the audit chain under that seat; and a shared secret in a URL is a secret in the proxy log, the browser history and the next Referer.

**Roles.**

| Role | Can |
|---|---|
| `reviewer` | Queue, case, timeline, decisions up to a T3 proposal, concurrence on proposals they did not make, their own decision log, their own shift and settings |
| `operator` | Everything a reviewer can, plus `/settings/people`, `/settings/policy`, `/queue/[caseId]/file`, and read access to any decision on their own customers |
| `owner` | Everything, plus the reason taxonomy and the wellness org defaults, across customers |

**Enforced, not advisory.** Every route checks the role server-side and the customer partition on every row it reads. The audit chain is the one read that is not partitioned, because seq is assigned across every customer, so walking or exporting a range of it is an operator act and the verifier's own detail string, which names the entry's kind and the customer that wrote it, goes to the server log rather than to the screen. Fixtures mode is not an auth mode: it disables all of this, so it is never inferred from a missing `DATABASE_URL` in production, and when it is on the app says so on every page. Beyond the chain, a reviewer with no `customerIds` match on a pair gets the not-found state rather than a 403, because a 403 confirms the case exists. Possession of a case URL is never the capability. There is no shared account, no link-based access and no anonymous read.

**What replaces it.** SSO with the customer's own identity provider, and a real `Reviewer` table so a decision references a row rather than a string from an env var. Until then, `Review.reviewerId` and `EvidenceBundle.humanViewedByReviewerId` hold the id from the JSON, which is stable enough to audit and not stable enough to ship to a customer. Say so in the operator agreement.

---

## 15. Build order

Week one, against `Pair`, `Review` and `EvidenceBundle` as they stand, plus the gap-1 to gap-3 migration:

1. Extend `FORBIDDEN_PATTERNS` and the string lint. This lands before any of the rest.
2. `/queue` with the case card, the ranking sentence and the filters.
3. `/queue/[caseId]` with the severity strip, the why panel, the pair and actor context, the policy panel and the timeline with normalization reveal, collapsed spans and the media row.
4. The decision panel with the full reason taxonomy, the three note prompts, minutes and the 60-second undo.

Week two, needing the gap-4 to gap-6 migrations:

5. Claim state and the read-only claimed-elsewhere view.
6. `/queue/[caseId]/propose` and `/concurrence`, including the read-bound attestation and the change-origin attestation.
7. The exposure meter, `/shift`, breaks, buffers and rotation.
8. `/queue/[caseId]/file`, the D-3 branch.

---

## 16. Acceptance checklist

The reviewers of this design check these, in this order. A failure in section A is a blocker regardless of anything else.

### A. Never-label (rules 4, 5, 6)

- [ ] `FORBIDDEN_PATTERNS` carries the RESEARCH 6.7 left column, and the lint fails CI on a violating literal in any `.ts` or `.tsx`.
- [ ] Every literal in `src/lib/copy.ts` passes `assertNoAccusation` at module load, and the module fails at import rather than at render.
- [ ] Every string built from data passes the guard at the data boundary, and a failure degrades the string rather than blanking the case.
- [ ] Every operator-authored string passes the guard at write time and is refused with the offending fragment quoted back.
- [ ] Every count and summary string is written about pairs and actors, and there is a test case for the aggregate form.
- [ ] No screen displays a fused score, a percentage risk, a watchlist, a list of people, or any adjective attached to a person.
- [ ] The word victim appears nowhere outside the NCMEC form field. The words clear, cleared, exonerate, innocent and false alarm appear nowhere.
- [ ] No API response body or key in this app names a person as a type.
- [ ] Nothing in this app can write `Pair.tier = T3`. The only T3 write is a concurrence on a proposal by a second reviewer who is not the proposer, enforced server-side.
- [ ] Propose is blocked when `soleAutomatedBasis` is true, with the reason printed.
- [ ] Overturn and reopen copy never says wrong, mistake or error. No decision row is edited or deleted after the undo window.

### B. Media and publication (rules 1, 3)

- [ ] There is no image element, no placeholder, no aspect-ratio box and no blur anywhere in the app.
- [ ] The media row carries all four lines, including "Guardian holds no image and there is nothing here to open."
- [ ] No link previews or unfurls. URLs render as inert text.
- [ ] No jump links, no platform message ids, no copy transcript, no export as image, no share, no print stylesheet.
- [ ] The three prohibitions appear on the confirm step, the propose step and the read-only view, and nowhere else.

### C. Evidence honesty

- [ ] `viewedByHuman` is written only on legible render to this reviewer or on reveal. Never on case open, never on scrolling past a collapsed span. The write goes on the audit chain as `evidence.read`, the read count counts only ids the server confirmed, and a confirm or a proposal is refused server-side on a pair with no `humanViewedAt`.
- [ ] Reveal-all warns how many spans it opens and that it writes read flags, before it opens them.
- [ ] The propose read claim is scoped to what was read, disabled with the reason in text until at least one excerpt is read, and there is no read quota.
- [ ] The bundle carries the completeness statement naming which excerpts a person read and which nobody did.
- [ ] The change-origin attestation is required on every proposal and on every policy or lexicon change, and lands in the chain.
- [ ] No Guardian reviewer can set the operator's human-viewed flag.
- [ ] Nothing softened is persisted. Bundle, chain and export carry verbatim text.

### D. Wellness

- [ ] The severity strip renders before the timeline is fetched, and Defer works having read nothing.
- [ ] Session budget 120 min, cases per hour 8, micro-break 25 min, buffer 90 s, rotation 12 weeks. Org may move each only in the protective direction.
- [ ] Collapse is a one-way ratchet, with no per-case override.
- [ ] The exposure meter is severity- and reveal-weighted, not case count.
- [ ] At 100% the queue stops serving, does not log out, does not interrupt an open case, and lands on lower-intensity work.
- [ ] The next case is never pre-loaded during a buffer.
- [ ] No running timer on the case. No per-reviewer speed, rank or target anywhere, and no per-reviewer pace value in any API response.
- [ ] Check-in participation is visible to the operator; content never is.
- [ ] Reduced motion is the default. No red on the tier scale. No pulsing, no counters, no sound, no auto-scroll.

### E. Speed and correctness of the loop

- [ ] A decision is two keystrokes: verb, then reason with Enter.
- [ ] Undo is 60 seconds, a persistent inline bar with the seconds in text, and writes a compensating entry. The bar survives the route revalidating the case as resolved, and the tier it restores is read from the review it compensates, never chosen by the caller.
- [ ] A failed write never advances the case and never looks like a completed decision.
- [ ] If the timeline failed, Confirm and Propose disable with the reason and Dismiss, Watch, Defer and Escalate stay live.
- [ ] Claim state is enforced. Opening a claimed case is read-only with a handoff request.
- [ ] A blocked proposal surfaces as a staffing class with the oldest proposal's age, addressed to whoever can add a seat, never as a reviewer's backlog.
- [ ] The one-seat branch records a reviewer-confirmed T2 with a drafted bundle and never a T3.

### F. Craft

- [ ] Spacing only from 4 8 12 16 24 32 48 64 96. Five type sizes, three weights.
- [ ] One accent, on the primary action and the active nav item only. No raw hex or px colour in any component.
- [ ] 1px borders, two elevation levels. A control's resting boundary is `--border` (3:1 on every surface), never `--divider`. A dialog dims the page with `--scrim`, never covers it with a surface.
- [ ] Every interactive element has default, hover, focus-visible, active, disabled and loading states. Disabled always prints its reason in text.
- [ ] Focus rings styled, never removed. Focus order follows reading order.
- [ ] Empty, loading and error states designed for every view. Loading skeletons at exact final height; nothing reflows.
- [ ] Errors are named, say what is unaffected, and retry manually. "Something went wrong" appears nowhere.
- [ ] 4.5:1 body contrast and 3:1 for meaningful UI, in both themes. Every text token is validated against `--bg`, `--surface` and `--surface-sunken`, not only against the page, and the generator fails the build on a pair below its minimum. No state is expressed with `opacity`, which composites a whole subtree and takes its text down with it. Tier never encoded in colour alone.
- [ ] Holds at 320px and at 2560px. No horizontal page scroll at any width.
- [ ] No em-dashes in any string, comment or doc.
