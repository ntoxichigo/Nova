# Performance and Optimization

## Main bottleneck classes

1. Large prompts and context inflation
2. Model/provider latency variance
3. Heavy dependencies in server path
4. Unbounded skill/tool execution paths

## Recommended defaults

1. Use low-latency chat path for conversational turns.
2. Cap max output tokens by task type.
3. Keep history budgets tight and rely on summaries.
4. Use model fallbacks for denied or unstable endpoints.

## Dependency weight controls

- `sharp` and `pdf-parse` are powerful but heavy.
- Keep these features server-only and avoid accidental client bundling.
- Use dynamic import for rare routes/features where possible.
- Track bundle impact before adding more parsing/media libraries.

## Measurement loop

1. Record P50/P95 response latency by provider/model.
2. Record tool call success/failure rates.
3. Track prompt and output token usage.
4. Use Doctor checks after major model/config changes.

## Quick commands

```bash
npm run lint
npm run typecheck
npm run build
```

Run these before profiling and after optimization changes to avoid chasing invalid baselines.
