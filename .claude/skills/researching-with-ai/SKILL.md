---
name: researching-with-ai
description: Use Cairn's evidence-first AI search workflow through its MCP tools or CLI. Use when asked to verify current software APIs, compare technical approaches, investigate recent news, find GitHub Issue solutions, research disputed claims from multiple viewpoints, or produce a source-backed answer with clickable citations.
---

# Researching with Cairn

Use Cairn to turn a research question into a recoverable search session with a query plan, ranked sources, evidence snippets, inline citations, and a verification report. Never expose hidden reasoning; report only the public plan, progress, evidence, and conclusions.

## Preflight

From the Cairn repository root, run:

```bash
node .claude/skills/researching-with-ai/scripts/healthcheck.mjs
```

Add `--smoke` to run a free Mock Provider search. The health check must never call a paid provider.

If dependencies are missing, run `corepack pnpm install`. If CLI artifacts are missing, run `corepack pnpm --filter @cairn/cli build`.

## Choose a mode

| Need | Mode | Default behavior |
|---|---|---|
| Current fact, latest API, focused lookup | `flash` | Low latency, one primary Provider, 5–8 sources |
| Complex research, recent news, GitHub errors, disputed claims | `dive` | Differentiated subqueries, broader sources, evidence checks |
| Compare approaches or independent model conclusions | `panel` | 2–3 Providers, then consensus and disagreement synthesis |
| X/Twitter real-time discussion | `pulse` | xAI only; keep social claims separate and unverified |

Read [provider capabilities](references/provider-capabilities.md) when choosing a Provider or diagnosing a capability mismatch. Read [search quality](references/search-quality.md) before handling disputed, high-stakes, or source-sensitive questions.

## Run research

Prefer Cairn MCP tools when they are connected:

- `cairn_flash_search` for focused lookups.
- `cairn_deep_research` for long-form investigation.
- `cairn_compare_models` for independent model comparison.
- `cairn_x_pulse` for X real-time signals.
- `cairn_task_status` and `cairn_get_result` for asynchronous sessions.

Otherwise, use the built CLI from the repository root:

```bash
node apps/cli/dist/index.js search "<question>" --mode flash --provider <provider> --json
node apps/cli/dist/index.js search "<question>" --mode dive --provider <provider> --json
node apps/cli/dist/index.js compare "<question>" --provider <provider-a> <provider-b> --json
node apps/cli/dist/index.js status <session-id> --json
node apps/cli/dist/index.js result <session-id> --json
```

Use `mock` for tests and demonstrations. Use configured real Providers for user-requested research; never run paid connectivity or regression tests without explicit authorization.

## Handle long or partial tasks

When an MCP call returns a session ID, retain it. Poll status rather than restarting the research. Fetch the full result once the state is `completed`, `partial`, `failed`, or `cancelled`. On timeout, report the session ID and current source count, then continue with `cairn_task_status`. CLI searches stay attached until a terminal result so the process that owns their in-memory work is not abandoned.

Return useful partial evidence when one Provider fails. State which Provider or source stage failed and what remains supported.

## Present the result

1. Lead with the direct answer.
2. Attach clickable citations to important factual claims.
3. Separate sourced facts, source opinions, and model inference.
4. Surface conflicts, uncertainty, retrieval time, and important missing evidence.
5. Mark X/social content as unverified; never equate popularity with reliability.
6. Never invent a citation or treat a search snippet as verified page evidence.
7. Never request or reveal hidden chain-of-thought.

See [trigger tests](references/trigger-tests.md) for the five canonical invocation cases and expected routing.
