# Security Guardrails

## Mandatory controls

1. Set `TOKEN_ENCRYPTION_SECRET` before storing any third-party tokens.
2. Set `NOVA_API_SECRET` (or legacy `NTOX_API_SECRET`) when app endpoints are exposed outside localhost.
3. Keep provider API keys in environment or encrypted settings only.
4. Keep `workspace_root` constrained before enabling filesystem tools.

## MCP integration policy

1. Treat every MCP server as privileged code execution.
2. Approve only known server binaries/endpoints.
3. Disable unused MCP connectors by default.
4. Log and review all MCP tool invocations.

## Permission model recommendation

- Default mode: `ask_risky`
- High-risk tools always require confirmation unless explicitly trusted
- `autopilot` only for trusted environments and low-risk connectors

## Incident response basics

1. Rotate provider/API keys immediately after suspected leak.
2. Disable affected connectors.
3. Export and inspect audit timeline.
4. Restore from known-good backup if workspace tampering occurred.
