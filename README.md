# Nova

Nova is a local-first agent chat alpha for technical users. It keeps the main workflow centered on conversation, while still exposing Studio, memory, and support tooling when the task genuinely needs them.

## Alpha focus

- Streaming agent chat with guarded tool execution
- Local Studio for project-aware files, previews, and commands
- Memory, teach, and skill support for iterative technical work
- Provider support for local and hosted LLMs
- Local-first posture with remote exposure disabled by default

## Quick start

1. Install dependencies

```bash
npm install
```

2. Create your environment file

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

3. Set required values in `.env`

```env
DATABASE_URL=file:./db/custom.db
TOKEN_ENCRYPTION_SECRET=replace-with-a-random-64-char-hex-string
```

Recommended for any non-local deployment (Nova env vars). Legacy `NTOX_*` env vars are still accepted.

```env
NOVA_API_SECRET=replace-with-a-long-random-string
NOVA_ALLOW_REMOTE_UI=false
```

4. Initialize DB and run development server

```bash
npm run db:generate
npm run db:push
npm run dev
```

5. Open `http://localhost:3000`

## Security defaults

- Localhost requests work out of the box.
- Remote UI is blocked unless `NOVA_ALLOW_REMOTE_UI=true` (or legacy `NTOX_ALLOW_REMOTE_UI=true`).
- Remote API calls require `NOVA_API_SECRET` (or legacy `NTOX_API_SECRET`).
- Webhook routes keep their own service-specific auth.

## Hero workflow

1. Start in chat and define the task.
2. Let Nova plan or draft the first pass.
3. Move into Studio only when files, previews, or commands are needed.
4. Use support surfaces like Teach, Skills, Doctor, and Ops as secondary tools.

## Cross-platform developer scripts

- Standard dev: `npm run dev`
- Cross-platform bootstrap (installs deps, pushes DB, starts app): `npm run dev:bootstrap`
- Windows helper script: `npm run dev:win`
- Unix helper script: `npm run dev:unix`
- Windows build helper: `npm run build:win`
- Windows start helper: `npm run start:win`

## Provider setup note (Xiaomi)

If you use Xiaomi Token Plan keys, set the base URL to:

```text
https://token-plan-ams.xiaomimimo.com/v1
```

Do not include trailing quotes or backticks in model or base URL fields.

## Scheduler

- Continuous mode: `npm run scheduler:run`
- One pass: `npm run scheduler:once`

Useful environment variables:

```env
NOVA_SCHEDULER_BASE_URL=http://localhost:3000
NOVA_SCHEDULER_INTERVAL_MS=60000
```

## Verification

```bash
npm run lint
npm run typecheck
npm run build
```

## Documentation map

- Onboarding guide: [docs/ONBOARDING.md](docs/ONBOARDING.md)
- Production deployment: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- Security guardrails: [docs/SECURITY.md](docs/SECURITY.md)
- Performance guide: [docs/PERFORMANCE.md](docs/PERFORMANCE.md)
- Skill quality audit: [docs/SKILLS.md](docs/SKILLS.md)
- Generated skill report: [docs/SKILL_AUDIT_REPORT.md](docs/SKILL_AUDIT_REPORT.md)

## Open-source alpha baseline

SQLite is fine for local and light workloads. For production, prefer PostgreSQL and set `DATABASE_URL` accordingly. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for details.
