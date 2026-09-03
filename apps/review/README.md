# review

Next.js reviewer queue. Phase 2 (DESIGN.md section 11), not built yet.

This is the only thing in Guardian that can produce tier T3 (CLAUDE.md rule 6).
The kernel tops out at T2 and the fusion layer enforces that structurally in
`apps/scorer/src/fusion.ts`; nothing here should ever bypass it.

## What it has to do

- Reviewer queue ordered by tier and age, with a 4 hour target on T2.
- Evidence timeline: text excerpts, timestamps, stage annotations, media
  hashes and the operator's scanner verdict. Never imagery. Guardian holds no
  image or video bytes and the reviewer never sees one, which is also what the
  reviewer wellness commitment in DESIGN.md section 9 rests on.
- One-click decisions: dismiss, watch, confirm, report. Each writes a `Review`
  row carrying the reviewer id, the model's tier, the resulting tier, the reason,
  and minutes spent. Reviewer minutes per 1,000 users is a first-class metric.
- Every decision goes through the audit chain as `review.decision`.
- Every string on screen passes `assertNoAccusation` from `@guardian/schema`.
  The queue describes conversations and tiers, never a kind of person.

## Scaffold

```bash
pnpm create next-app@latest . --ts --app --no-tailwind
```

Then wire `@guardian/schema` for the types and `@guardian/audit` for the chain.
