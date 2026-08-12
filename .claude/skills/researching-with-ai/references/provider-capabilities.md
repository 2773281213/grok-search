# Provider capabilities

Choose a Provider by declared capability, not by assuming that every OpenAI-compatible endpoint supports the same search tools.

| Provider | Native web search | Social search | Streaming | Citation shape | Model discovery |
|---|---:|---:|---:|---|---:|
| xAI / Grok | Yes (`web_search`) | Yes (`x_search`) | Yes | Response citations and tool sources | Yes |
| OpenAI / GPT | Yes (`web_search`) | No | Yes | URL annotations and web-search sources | Yes |
| Anthropic / Claude | Yes (server web-search tool) | No | Yes | Citation deltas and tool-result blocks | Yes |
| Cairn Mock | Deterministic fixtures | Simulated label only | Yes | Fixed structured sources | Fixed list |

## Selection rules

- Use xAI for `pulse` mode or when X is explicitly requested.
- Use OpenAI or Anthropic for ordinary web research according to configured models and availability.
- Use two or three independently configured Providers for `panel`.
- Use Mock only for tests, demos, health checks, and offline validation. Its sources exercise data flow; they are not answers to arbitrary current questions.
- Keep model IDs and Base URLs in server configuration. Never hard-code an assumed “latest” model.
- If a requested capability is unavailable, explain the fallback and choose a compatible mode instead of silently dropping the requirement.

## Configuration boundaries

Keys come only from `XAI_API_KEY`, `OPENAI_API_KEY`, and `ANTHROPIC_API_KEY`. Never request a full key from a browser response, logs, search results, or skill output.
