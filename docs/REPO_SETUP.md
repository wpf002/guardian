# Repo setup

Run from the unzipped `guardian/` folder.

```bash
cd guardian
git init -b main
git add .
git commit -m "Guardian: design doc, CLAUDE.md, bootstrap scaffold"

# create the GitHub repo (private) and push
gh repo create wpf002/guardian --private --source=. --remote=origin --push
# or, without gh:
# git remote add origin git@github.com:wpf002/guardian.git
# git push -u origin main
```

Then, in the repo:

```bash
chmod +x scripts/bootstrap.sh
./scripts/bootstrap.sh
pnpm db:migrate
pnpm dev
```

Open the folder in Claude Code. `CLAUDE.md` carries the rules and the current phase; `docs/DESIGN.md` is the spec. First prompt that works well:

> Read CLAUDE.md and docs/DESIGN.md. We're in phase 1. Implement packages/schema (Event/Pair/Actor zod types matching the Prisma schema, plus the lexicon loader and normalizer from §6.5) with tests, then stop and show me.
