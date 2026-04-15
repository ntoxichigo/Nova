# Onboarding Guide

## Who this is for

This guide is for new Nova contributors and operators who need to get from clone to first successful run quickly.

## First run checklist

1. Install Node.js 20+ and npm.
2. Clone the repo and run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `DATABASE_URL` and `TOKEN_ENCRYPTION_SECRET`.
5. Run `npm run db:generate` and `npm run db:push`.
6. Start with `npm run dev` or `npm run dev:bootstrap`.

## Recommended local sequence

1. `npm run typecheck`
2. `npm run lint`
3. `npm run dev`
4. Open `http://localhost:3000`
5. Configure LLM provider in Settings
6. Run provider test from Settings before starting heavy chats

## Feature orientation

- Chat: general assistant, tool-calls, slash commands
- IDE: workspace-aware editing and project actions
- Skills: capability modules and tool routing hints
- Teach: feed knowledge and memory
- Dashboard: memory and retrieval visibility
- Doctor: diagnostics for provider, stream, tools, project flow

## Common pitfalls

- Xiaomi base URL pasted with trailing quote/backtick
- Wrong model ID for provider plan
- Missing `TOKEN_ENCRYPTION_SECRET`
- Enabling risky tools before setting guardrails

## Suggested first tasks for new users

1. Create a small sample project in IDE.
2. Try `/commands` in chat.
3. Save one memory and confirm retrieval.
4. Run Doctor checks once after provider setup.
