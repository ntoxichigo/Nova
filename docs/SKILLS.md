# Skill Quality and Audit Process

## Why this exists

Nova has many skills, but quantity alone does not guarantee quality. This process makes skill quality explicit and measurable.

## Audit command

Generate an up-to-date skill quality report:

```bash
npm run skills:audit
```

Output file:

- `docs/SKILL_AUDIT_REPORT.md`

## Current scoring model

Each skill is scored out of 100:

- `SKILL.md` present: 40
- `scripts/` present: 20
- `references/` present: 15
- `_meta.json` present: 10
- `examples/` or `assets/` present: 15

Grades:

- A: 85+
- B: 70-84
- C: 55-69
- D: below 55

## Definition of ready

Minimum bar for production-ready skill:

1. Grade B or higher
2. Clear `SKILL.md` with scope and limits
3. At least one executable script or deterministic workflow
4. At least one practical example

## Improvement workflow

1. Run `npm run skills:audit`.
2. Pick C/D skills with highest business impact.
3. Add missing docs/scripts/examples.
4. Re-run audit and compare deltas.
