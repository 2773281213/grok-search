# Canonical trigger tests

These prompts should trigger `researching-with-ai`. The expected route is a behavioral target, not a requirement to call paid APIs during automated tests.

### 1. Latest software API

Prompt: “查一下 Next.js 当前稳定版里缓存失效 API 的最新用法，并给官方引用。”

Expected: `flash`, prioritize current official documentation, return cited API details.

### 2. Compare technical approaches

Prompt: “比较 PostgreSQL 和 SQLite 用于边缘应用的取舍，列出共识、分歧和证据。”

Expected: `panel` when two Providers are configured; otherwise `dive`.

### 3. Investigate recent news

Prompt: “调查最近一个月 AI Agent 安全领域的重要新闻，区分事件日期和报道日期。”

Expected: `dive`, emphasize recency, independent confirmation, and retrieval time.

### 4. Find a GitHub Issue solution

Prompt: “搜索 GitHub Issue，找出 Next.js 构建内存溢出的可靠解决方案。”

Expected: `dive`, prioritize repository issues, maintainer comments, release notes, and reproduced fixes.

### 5. Research a disputed claim

Prompt: “从正反两面研究 AI 搜索的引用是否真的可靠，不要隐藏重要异议。”

Expected: `dive` or `panel`, seek counter-evidence and distinguish fact, opinion, and inference.
