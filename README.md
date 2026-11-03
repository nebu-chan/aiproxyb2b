# AI Gateway — B2B API Proxy Platform

A multi-tenant B2B platform that proxies requests to AI model providers, with per-org API keys, rate limiting, quotas, and a React analytics dashboard.

## Architecture

```
frontend/    React + Vite + TypeScript (dashboard)
backend/     Fastify + TypeScript (API gateway + admin API)
docker-compose.yml  PostgreSQL 16 + Redis 7
```

## Quick start

### 1. Start infrastructure

```bash
docker compose up -d
```

### 2. Backend

```bash
cd backend
cp .env.example .env        # fill in JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm install
npm run db:generate         # generate migration files
npm run db:push             # apply schema to DB
npx tsx src/db/seed.ts      # create superadmin user (reads from .env)
npm run dev                 # starts on :3001
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                 # starts on :5173, proxies /api → :3001
```

Open http://localhost:5173

---

## Proxy API usage

Clients authenticate with an API key (`Authorization: Bearer sk-...`) and send requests to:

```
POST /v1/proxy/{provider}/{upstream-path}
```

Example (OpenAI-compatible):
```bash
curl http://localhost:3001/v1/proxy/openai/chat/completions \
  -H "Authorization: Bearer sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello"}]}'
```

---

## Adding providers (admin)

1. Sign in as superadmin
2. Go to **Providers** in the sidebar
3. Add a provider: name (slug), base URL, auth header, upstream API key

Example provider configuration for OpenAI:
- **Name**: `openai`
- **Base URL**: `https://api.openai.com/v1`
- **Auth header name**: `Authorization`
- **Auth header prefix**: `Bearer`
- **API Key**: your OpenAI key

The AI provider API specification can be added here when ready — additional typed proxy routes can be added in `backend/src/routes/proxy.ts`.

---

## Key concepts

| Concept | Description |
|---|---|
| **Organization** | A tenant company. Has users, API keys, and quotas. |
| **API Key** | A `sk-...` secret for machine-to-machine proxy access. Stored as SHA-256 hash. |
| **Provider** | An upstream AI API (OpenAI, Anthropic, etc.) configured in the DB. |
| **Quota** | Per-org limits: requests/minute, requests/day, tokens/day — enforced via Redis. |
| **Usage log** | Every proxy request is logged with model, tokens, latency, status code. |

---

## Roles

| Role | Access |
|---|---|
| `superadmin` | All orgs, providers, quotas, platform stats |
| `admin` | Own org: users, API keys, analytics |
| `member` | Own org: analytics (read-only) |
