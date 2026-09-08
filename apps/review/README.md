# review

Next.js reviewer queue. Phase 2 (DESIGN.md section 11), built.

This is the only thing in Guardian that can produce tier T3 (CLAUDE.md rule 6).
The kernel tops out at T2 and the fusion layer enforces that structurally in
`apps/scorer/src/fusion.ts`; nothing here should ever bypass it.

One code path writes a decision, `src/lib/decisions.ts`. T3 needs a proposal
from one reviewer and an upheld concurrence from a second, and the second cannot
be the proposer. `recordDecision` takes that concurrence today; the console has
no screen that supplies one, which is the largest open item in
[docs/V1.md](../../docs/V1.md) section 1.

## Routes

| Route | What it is |
|---|---|
| `/queue` | The ranked list. One column, three shapes, a line of the conversation on every row. |
| `/cases`, `/cases/[id]` | The case: severity strip, why sentence, evidence timeline, decision panel, report draft and trail. |
| `/dashboard` | Operator numbers. Handling time is never shown per person and never compared between people. |
| `/guilds`, `/guilds/[guildId]` | Discord owner setup, mirroring the slash commands. |
| `/audit`, `/audit/[seq]` | The hash chain, and the regulator export. |
| `/settings` | The seat, the lexicon extension, the webhook, retention. |

## Running it

```bash
pnpm --filter @guardian/review run dev:mock
```

Fixtures mode on port 3100, no database. It is never inferred in production and
every page says so while it is on.

## What holds

- Confirm and propose stay disabled until an excerpt has actually been rendered
  to this reviewer. `markExcerptsViewed` is the only thing that sets
  `humanViewedAt`, and the server checks its own record rather than the
  browser's claim.
- The Review row, the pair update and the chain entry are one transaction.
- Every string on screen passes `assertNoAccusation` from `@guardian/schema`.
  The queue describes conversations and tiers, never a kind of person.
- The theme's contrast pairs are re-checked against the shipped stylesheet in
  `src/styles/theme.test.ts`.
