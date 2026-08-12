# Search quality

Cairn treats a final answer as a set of claims supported by a traceable source and evidence graph, not as one model completion.

## 1. Intent and planning

Intent captures question kind, time sensitivity, language, domain hints, desired depth, and whether social evidence is relevant. Deep research uses role-distinct queries: core facts, primary/official sources, latest state, counter-evidence and risks, alternate-language material, and social discussion only when justified.

Planner models may refine this plan, but malformed, repetitive, or unsupported output falls back to deterministic local planning.

## 2. Retrieval and normalization

Providers use their native search tools and emit normalized candidates. Cairn canonicalizes URLs, removes tracking parameters, groups duplicates, detects likely social material, and keeps Provider tool status and usage.

The secure fetcher validates both the requested host and redirects, blocks private and special-use addresses, bounds body size and time, and cleans HTML to text. Retrieval failures do not erase other evidence.

## 3. Scoring

Scores combine:

- question relevance;
- recency when the question is time-sensitive;
- source type and first-party authority;
- direct support for the claim;
- corroboration and source diversity;
- penalties for weak, duplicated, social-only, or suspicious material.

Domain reputation is a signal, never an absolute rule. Multiple copies of one upstream report do not count as independent confirmation.

## 4. Evidence

High-ranked pages yield bounded snippets tied to source IDs and supported claims. The synthesis prompt receives this public evidence context, not private chain-of-thought. Panel mode also keeps each Provider’s independent answer and exposes disagreements instead of flattening them.

## 5. Citation verification

Inline markers are mapped only to returned sources. The verifier records dangling markers, likely uncited claims, dead sources, checked counts, and dependence risks. An optional Judge can add a public review, but it cannot bypass local mapping.

Answers must distinguish:

- directly supported facts;
- claims or opinions attributed to a source;
- Cairn/model inference;
- uncertainty and missing evidence.

X posts and similar social material remain visibly unverified regardless of engagement.

## 6. Time-sensitive and high-stakes work

Record retrieval time and compare publication dates with event dates. Prefer current primary or authoritative material. For medical, legal, financial, or safety decisions, Cairn is research assistance and should not be presented as professional advice.
