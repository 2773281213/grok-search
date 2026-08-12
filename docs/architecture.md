# Cairn architecture

## Runtime flow

```text
Web Route / MCP tool / CLI command
              |
              v
       SearchRequestSchema
              |
              v
         SearchEngine
   intent -> plan -> retrieve
              |
      ProviderRegistry
   xAI | OpenAI | Anthropic | Mock
              |
              v
 normalize -> fetch -> dedupe -> rank
              |
              v
 evidence -> synthesize -> verify citations
              |
              v
 SQLite repository + ordered EventHub
              |
      SSE / MCP result / CLI output
```

## Packages

### `packages/shared`

The single domain contract: modes, statuses, requests, sources, evidence, answers, citations, usage, settings, event payloads, IDs, limits, URL canonicalization, and safe text utilities. Client-safe exports avoid bundling Node-only code into the browser.

### `packages/providers`

Each Provider owns its request and event differences. All adapters emit a common `ProviderEvent` stream while keeping capability flags such as native web search, X search, model discovery, and plain generation explicit.

### `packages/storage`

`better-sqlite3` and Drizzle provide synchronous, transaction-safe local persistence. Migrations are idempotent. Repository methods rebuild a complete `SessionSnapshot`, including ordered event sequence numbers used for SSE recovery.

### `packages/search-core`

The orchestration layer owns:

- intent classification and mode profiles;
- deterministic query roles plus optional model-assisted Planner refinement;
- bounded Provider execution with classified retry and cancellation;
- secure page fetching, source normalization, clustering, and scoring;
- evidence extraction and synthesis;
- local citation verification plus optional Judge review;
- partial-failure behavior and session lifecycle.

The local rules remain authoritative for schemas, network safety, deduplication, and citation mapping even when Planner, Synthesizer, or Judge roles are assigned to a model.

## Entry points

- `apps/web` creates one process-local runtime shared by Route Handlers. Search events are first persisted, then broadcast. A reconnect supplies `after=<last-sequence>` and receives missed events before live events.
- `apps/mcp` keeps a runtime alive for the lifetime of the stdio connection. Long tools can return session IDs while work continues inside that server process.
- `apps/cli` opens the same runtime and database for a terminal command, streams public progress, prints structured output, and closes gracefully.

## State recovery

The SQLite database is the source of truth. In-memory subscriptions improve latency but are not required to restore a completed result. Refreshing a result page reads the snapshot from SQLite; an unfinished page reconnects from its last durable event number.

## Trust boundaries

The browser never instantiates Providers. Keys and Base URLs are read only in Node runtimes. Provider settings returned to the UI contain only masked key state. External pages pass protocol, DNS/IP, redirect, timeout, size, and HTML-to-text controls before entering evidence extraction.
