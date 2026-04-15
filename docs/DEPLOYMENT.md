# Production Deployment Guide

## Overview

Nova can run locally with SQLite, but production should use PostgreSQL, managed secrets, and reverse-proxy TLS termination.

## Architecture baseline

1. Next.js app container or VM process
2. PostgreSQL database
3. Reverse proxy (Caddy/Nginx/Cloud LB)
4. Optional scheduler worker process

## Environment variables

Required:

- `DATABASE_URL` (PostgreSQL in production)
- `TOKEN_ENCRYPTION_SECRET`
- `NEXT_PUBLIC_APP_URL`
- `NEXTAUTH_URL`

Recommended:

- `NOVA_API_SECRET` (or legacy `NTOX_API_SECRET`)
- `NOVA_SCHEDULER_BASE_URL` (or legacy `NTOX_SCHEDULER_BASE_URL`)
- `NOVA_SCHEDULER_INTERVAL_MS` (or legacy `NTOX_SCHEDULER_INTERVAL_MS`)

## Database migration path

1. Point `DATABASE_URL` to PostgreSQL.
2. Run `npm run db:generate`.
3. Run `npm run db:migrate` for managed schema evolution.
4. Validate startup and key API routes before traffic cutover.

## Runtime commands

Build:

```bash
npm install
npm run build
```

Start:

```bash
npm run start
```

Optional scheduler:

```bash
npm run scheduler:run
```

## Hardening checklist

1. Put app behind TLS proxy.
2. Restrict inbound traffic to required ports only.
3. Rotate API keys and encryption secrets on schedule.
4. Restrict MCP connectors to approved servers only.
5. Enable log aggregation and alerting.

## Scaling notes

- SQLite is not recommended for high-write concurrency.
- Move to PostgreSQL before multi-user or persistent automation workloads.
- Keep heavy workflows off request path when possible.
- Separate scheduler worker from web process when load increases.
