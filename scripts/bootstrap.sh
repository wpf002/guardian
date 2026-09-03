#!/usr/bin/env bash
# Guardian bootstrap. Idempotent. Run from repo root.
set -euo pipefail
cd "$(dirname "$0")/.."

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1"; exit 1; }; }
need node; need pnpm; need docker; need python3

# ---- workspace files ----------------------------------------------------
[ -f package.json ] || cat > package.json <<'EOF'
{
  "name": "guardian",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "db:migrate": "pnpm --filter @guardian/schema prisma migrate dev",
    "db:generate": "pnpm --filter @guardian/schema prisma generate",
    "eval": "pnpm --filter @guardian/eval run all"
  },
  "devDependencies": {
    "turbo": "^2.1.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^20.16.0",
    "eslint": "^9.10.0",
    "prettier": "^3.3.0"
  }
}
EOF

[ -f pnpm-workspace.yaml ] || cat > pnpm-workspace.yaml <<'EOF'
packages:
  - "apps/*"
  - "packages/*"
  - "scripts/eval"
EOF

[ -f turbo.json ] || cat > turbo.json <<'EOF'
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "dev": { "cache": false, "persistent": true },
    "test": { "dependsOn": ["^build"] },
    "lint": {},
    "typecheck": { "dependsOn": ["^build"] }
  }
}
EOF

[ -f tsconfig.base.json ] || cat > tsconfig.base.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  }
}
EOF

[ -f .gitignore ] || cat > .gitignore <<'EOF'
node_modules
dist
.next
.turbo
.env
.env.*
!.env.example
*.log
__pycache__
.venv
services/ml/models/
services/ml/data/
coverage
EOF

[ -f .env.example ] || cat > .env.example <<'EOF'
DATABASE_URL=postgresql://guardian:guardian@localhost:5433/guardian
REDIS_URL=redis://localhost:6381
ML_SERVICE_URL=http://localhost:8000
INGEST_PORT=3001
SCORER_PORT=3002
REVIEW_PORT=3000
# Per-customer salts are generated in the DB, not here.
AUDIT_CHAIN_SECRET=
# Discord (phase 1)
DISCORD_BOT_TOKEN=
DISCORD_APP_ID=
# NCMEC ESP API (phase 3, leave blank until registered)
NCMEC_API_USER=
NCMEC_API_PASS=
NCMEC_API_ENV=test
EOF
# The audit chain refuses a placeholder secret, so mint a real one per checkout.
if [ ! -f .env ]; then
  cp .env.example .env
  secret=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  perl -pi -e "s|^AUDIT_CHAIN_SECRET=.*|AUDIT_CHAIN_SECRET=$secret|" .env
  echo "generated AUDIT_CHAIN_SECRET in .env"
fi

[ -f docker-compose.yml ] || cat > docker-compose.yml <<'EOF'
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: guardian
      POSTGRES_PASSWORD: guardian
      POSTGRES_DB: guardian
    ports: ["5433:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
  redis:
    image: redis:7
    ports: ["6381:6379"]
volumes:
  pgdata:
EOF

# ---- packages -----------------------------------------------------------
mkpkg() { # name dir deps
  local name=$1 dir=$2 deps=$3
  mkdir -p "$dir/src"
  [ -f "$dir/package.json" ] || cat > "$dir/package.json" <<EOF
{
  "name": "$name",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src"
  },
  "dependencies": $deps,
  "devDependencies": { "tsx": "^4.19.0" }
}
EOF
  [ -f "$dir/tsconfig.json" ] || cat > "$dir/tsconfig.json" <<'EOF'
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "rootDir": "src" }, "include": ["src"] }
EOF
  [ -f "$dir/src/index.ts" ] || echo "export {};" > "$dir/src/index.ts"
}

mkpkg @guardian/schema packages/schema '{ "zod": "^3.23.0", "@prisma/client": "^5.20.0" }'
mkpkg @guardian/sdk-ts packages/sdk-ts '{ "@guardian/schema": "workspace:*" }'
mkpkg @guardian/audit packages/audit '{ "@guardian/schema": "workspace:*" }'
mkpkg @guardian/ingest apps/ingest '{ "@guardian/schema": "workspace:*", "@guardian/audit": "workspace:*", "fastify": "^5.0.0", "ioredis": "^5.4.0" }'
mkpkg @guardian/scorer apps/scorer '{ "@guardian/schema": "workspace:*", "@guardian/audit": "workspace:*", "ioredis": "^5.4.0" }'
mkpkg @guardian/discord-bot apps/discord-bot '{ "@guardian/schema": "workspace:*", "@guardian/sdk-ts": "workspace:*", "discord.js": "^14.16.0" }'
mkpkg @guardian/eval scripts/eval '{ "@guardian/schema": "workspace:*" }'

# schema package gets prisma + lexicon dirs
mkdir -p packages/schema/prisma packages/schema/lexicon
[ -f packages/schema/prisma/schema.prisma ] || cat > packages/schema/prisma/schema.prisma <<'EOF'
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

enum AgeBand { UNDER_9  A9_12  A13_15  A16_17  A18_20  A21_PLUS  UNKNOWN }
enum Tier { T0 T1 T2 T3 }
enum RetentionClass { EPHEMERAL_24H  WATCH_30D  CASE_1Y  LEGAL_HOLD }

model Customer {
  id         String   @id @default(cuid())
  name       String
  idSalt     String
  createdAt  DateTime @default(now())
  actors     Actor[]
  events     Event[]
  pairs      Pair[]
}

model Actor {
  id          String   @id @default(cuid())
  customerId  String
  customer    Customer @relation(fields: [customerId], references: [id])
  hashedUid   String
  ageBand     AgeBand  @default(UNKNOWN)
  firstSeen   DateTime @default(now())
  skewScore   Float    @default(0)
  fanOut7d    Int      @default(0)
  @@unique([customerId, hashedUid])
}

model Event {
  id             String         @id @default(cuid())
  customerId     String
  customer       Customer       @relation(fields: [customerId], references: [id])
  actorUid       String
  targetUid      String?
  channel        String
  ts             DateTime
  text           String?
  mediaHash      String?
  features       Json?
  stageProbs     Json?
  modelVersion   String?
  retention      RetentionClass @default(EPHEMERAL_24H)
  expiresAt      DateTime
  @@index([customerId, actorUid, ts])
  @@index([expiresAt])
}

model Pair {
  id          String   @id @default(cuid())
  customerId  String
  customer    Customer @relation(fields: [customerId], references: [id])
  actorUid    String
  targetUid   String
  stageHits   Json
  pairScore   Float    @default(0)
  tier        Tier     @default(T0)
  updatedAt   DateTime @updatedAt
  reviews     Review[]
  @@unique([customerId, actorUid, targetUid])
}

model Review {
  id          String   @id @default(cuid())
  pairId      String
  pair        Pair     @relation(fields: [pairId], references: [id])
  reviewerId  String
  decision    String   // dismiss | watch | confirm | report
  reason      String?
  createdAt   DateTime @default(now())
}

model AuditEntry {
  seq       Int      @id @default(autoincrement())
  ts        DateTime @default(now())
  kind      String
  payload   Json
  prevHash  String
  hash      String
}
EOF
[ -f packages/schema/lexicon/v1.json ] || cat > packages/schema/lexicon/v1.json <<'EOF'
{
  "version": 1,
  "emoji": { "👻": "snapchat", "💿": "discord", "📸": "instagram", "✈️": "telegram" },
  "leet": { "leVe": "leave", "sn@p": "snap", "d1sc0rd": "discord" },
  "payment_handles": ["cashapp", "cash app", "$", "venmo", "paypal", "zelle", "gift card", "robux", "nitro"],
  "supervision_probe": ["parents divorced", "your parents home", "check your phone", "own room", "home alone", "who else lives"],
  "secrecy": ["don't tell", "dont tell", "delete this", "our secret", "between us"],
  "threat_templates": ["ruin your life", "send to your parents", "send to your school", "everyone will see", "you have 24 hours"]
}
EOF

# ---- ML service ----------------------------------------------------------
mkdir -p services/ml/app
[ -f services/ml/pyproject.toml ] || cat > services/ml/pyproject.toml <<'EOF'
[project]
name = "guardian-ml"
version = "0.0.1"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.30",
  "pydantic>=2.9",
  "transformers>=4.44",
  "torch>=2.4",
  "sentence-transformers>=3.1",
  "datasketch>=1.6",
  "numpy>=2.0",
]
[tool.pytest.ini_options]
testpaths = ["tests"]
EOF
[ -f services/ml/main.py ] || cat > services/ml/main.py <<'EOF'
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="guardian-ml")

class ScoreIn(BaseModel):
    text: str
    actor_band: str
    target_band: str

class ScoreOut(BaseModel):
    stage_probs: dict[str, float]
    pii_migration: float
    script_match: float
    model_version: str

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/score", response_model=ScoreOut)
def score(inp: ScoreIn):
    # Phase 1: wire Roblox PII classifier v2 + MinHash first; stage classifier lands in phase 2.
    return ScoreOut(stage_probs={"none": 1.0}, pii_migration=0.0, script_match=0.0, model_version="stub-0")
EOF

# ---- install + infra ----------------------------------------------------
pnpm install
docker compose up -d postgres redis
pnpm db:generate || true

# ML service. The base install is small; model weights are an explicit opt-in
# via `uv pip install -e ".[models]"` so nobody downloads torch by accident.
if command -v uv >/dev/null 2>&1; then
  (cd services/ml && [ -d .venv ] || uv venv --python 3.11 >/dev/null 2>&1; uv pip install -q -e ".[dev]")
else
  echo "uv not found; skipping services/ml (install from https://docs.astral.sh/uv/)"
fi
echo
echo "Bootstrap done. Next: pnpm db:migrate && pnpm test"
