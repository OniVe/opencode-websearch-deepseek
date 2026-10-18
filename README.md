# opencode-websearch-deepseek

A web search provider for OpenCode's **built-in** `websearch` tool with two
backends:

- **`native`** (default for DeepSeek, or whenever `searchBaseUrl` is set) —
  uses DeepSeek's JSON
  [Search & Fetch APIs](https://api-docs.deepseek.com/api/search): structured
  results, optional page content, and optional full-page Markdown via Fetch.
  The calling model writes the answer from the returned sources.
- **`messages`** — backward-compatible Anthropic Messages backend with the
  server-side `web_search_20250305` tool. The provider searches and writes a
  synthesized answer. It remains the default for other providers without a
  `searchBaseUrl` and can be selected explicitly with `searchApi: "messages"`.

It registers through the OpenCode V2 plugin API (`ctx.websearch.transform`) as a
native search provider, so **no MCP server is required**, and also exposes the
same search to Code Mode as `tools.websearch.search(...)` when the runtime
supports tools.

- Zero runtime dependencies (uses the global `fetch`).
- Provider presets: `deepseek` (default) and `anthropic`, plus any custom
  Anthropic-compatible endpoint via `baseUrl`.
- Configurable provider, native result/fetch options, and the legacy
  `messages` model/`max_uses`/thinking options.

## Requirements

- **OpenCode 2.x** with the V2 plugin API (the `plugins` config field). The
  OpenCode 1.x plugin loader expects the legacy `server()` export and will not
  load this plugin.
- Node.js 22.14+ at runtime (OpenCode's runtime already provides it).
- Bun 1.4+ for development (`bun install`, tests, Biome).
- An API key for the selected provider (DeepSeek by default), or that provider
  authenticated in OpenCode (`opencode auth login`).

## Install

### With the OpenCode CLI

```sh
opencode plugin add opencode-websearch-deepseek
```

### Manually

Add the package to the `plugins` array in your global
`~/.config/opencode/opencode.json(c)`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-websearch-deepseek"]
}
```

Pin a version if you prefer:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-websearch-deepseek@<version>"]
}
```

Restart the OpenCode service after changing the config:

```sh
opencode service restart
```

## Configure

### Plugin options

The recommended way to configure the plugin is the `plugins` object form (read
from `ctx.options`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-websearch-deepseek",
      "options": {
        "provider": "deepseek",
        "apiKey": "{file:~/.config/opencode/deepseek.key}",
        "searchApi": "native",
        "count": 10,
        "needContent": false,
        "fetch": 0
      }
    }
  ]
}
```

| Option          | Default                     | Description                                            |
| --------------- | --------------------------- | ------------------------------------------------------ |
| `provider`      | `deepseek`                  | Preset (`deepseek`, `anthropic`) or any integration id. |
| `baseUrl`       | provider endpoint           | Full Anthropic-compatible `/v1/messages` URL override. |
| `apiKey`        | —                           | API key; takes precedence over env and the credential. |
| `model`         | provider default            | Model used for search and synthesis (`messages`).      |
| `maxUses`       | `5`                         | Max server-side searches per query (`messages`).       |
| `thinking`      | `enabled`                   | `enabled` or `disabled` (`messages`).                  |
| `searchApi`     | see below                   | `native` (DeepSeek JSON APIs) or `messages` (answer).  |
| `searchBaseUrl` | derived                     | Base URL (origin/prefix) for the native APIs.          |
| `count`         | `10`                        | Native results to request (1–50).                      |
| `needContent`   | `false`                     | Pass `need_content` to the native Search API.          |
| `fetch`         | `0`                         | Fetch full page Markdown for the top N native results. |

When `searchApi` is unset, a `searchBaseUrl` (option or env) selects `native`
for any provider and takes priority over `baseUrl`. Otherwise `native` is used for
`deepseek` unless a custom `baseUrl` (Messages endpoint) is configured, and
`messages` is used for other providers.

`count`, `needContent`, and `fetch` are ignored in `messages` mode.

### Environment variables

| Variable             | Provider  | Description                                          |
| -------------------- | --------- | ---------------------------------------------------- |
| `DEEPSEEK_API_KEY`   | deepseek  | API key for the default provider.                    |
| `ANTHROPIC_API_KEY`  | anthropic | API key for the `anthropic` provider.                |
| `WEBSEARCH_API_KEY`  | any       | Generic fallback API key.                            |
| `WEBSEARCH_MODEL`    | any       | Model override (`messages`).                         |
| `WEBSEARCH_MAX_USES` | any       | Max searches per query, positive integer (default 5).|
| `WEBSEARCH_THINKING` | any       | `enabled` (default) or `disabled`.                   |
| `WEBSEARCH_SEARCH_API` | any     | `native` (default for deepseek) or `messages`.       |
| `WEBSEARCH_SEARCH_BASE_URL` | any | Base URL for the native Search & Fetch APIs.       |
| `WEBSEARCH_COUNT`    | native    | Results per native search (1–50, default 10).        |
| `WEBSEARCH_NEED_CONTENT` | native | `true` to request page content.                    |
| `WEBSEARCH_FETCH`    | native    | Fetch full Markdown for the top N results (default 0).|

### Resolution order

- **API key:** `options.apiKey` → provider env var (`DEEPSEEK_API_KEY` /
  `ANTHROPIC_API_KEY`, then `WEBSEARCH_API_KEY`) → credential OpenCode stores for
  the provider's integration (after `opencode auth login`). No key is needed when
  the provider is authenticated in OpenCode.
- **Model:** `options.model` → `WEBSEARCH_MODEL` → OpenCode's default model when
  it belongs to the same provider → provider preset default. Resolved once with
  a 2 s startup budget; on timeout the preset is used immediately and a
  background refresh updates it. Providers without a preset wait up to 2 s on
  the first search, then retry with a cooldown.
- **Endpoint:** `options.baseUrl` → provider preset
  (`https://api.deepseek.com/anthropic/v1/messages`,
  `https://api.anthropic.com/v1/messages`).
- **`maxUses` / `thinking`:** option → env var → default.
- **`searchApi`:** option → `WEBSEARCH_SEARCH_API` → `native` when
  `searchBaseUrl` is set; otherwise `native` for `deepseek` unless a custom
  `baseUrl` is set; `messages` for other providers.
- **Native base URL:** `options.searchBaseUrl` → env → derived from `baseUrl`
  by stripping its `/anthropic/v1/messages` or `/v1/messages` suffix (otherwise
  set `searchBaseUrl`) → `https://api.deepseek.com`.
- **`count` / `needContent` / `fetch`:** option → env var → default.

OpenCode interpolates `{file:...}` (and `{env:...}`) in config values, so the key
can live in a file instead of the OS environment.

> If no key is found, a `websearch` call fails with a clear error rather than
> silently falling back to a different provider.

### Native Search & Fetch

`native` is the default for DeepSeek, and for any provider when `searchBaseUrl`
is set (unless `searchApi: "messages"` is explicit). It uses
DeepSeek's raw JSON APIs instead of the Messages tool:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-websearch-deepseek",
      "options": {
        "searchApi": "native",
        "count": 10,
        "needContent": true,
        "fetch": 3
      }
    }
  ]
}
```

- `POST /v1/tools/search` returns ranked results (`title`, `url`, `summary`,
  `snippet`, `content`, `date`, `authority`). Each source's `content` is
  `content || summary || snippet`.
- `needContent: true` sets `need_content`, so DeepSeek returns page content in
  the search response.
- `fetch: N` then calls `POST /v1/tools/fetch` for the top N results and
  replaces their content with full page Markdown. Fetch is best effort: the
  search still succeeds if a page cannot be retrieved. Search starts and fetch
  starts are each paced process-wide by about 210 ms (below the 5 QPS limit;
  the Search and Fetch quotas are independent); failures are reported once via
  `console.warn`.
- The native Search API does **not** synthesize an answer, so `answer` is `""`;
  the provider returns the source list and `tools.websearch.search` returns
  `{ answer: "", sources }`. The model reads the source content.
- Only `url`, `title`, and `content` are exposed to the model; `site_name`,
  `site_icon`, `date`, `authority`, and `rerank_score` are present in the API
  response but are not exposed.
- The base URL defaults to `https://api.deepseek.com` and can be overridden with
  `searchBaseUrl` (an origin or path prefix without `/v1`; the `/v1/tools/*`
  suffix is appended, and a `/v1` suffix is rejected). It is also derived from
  a custom `baseUrl` by stripping the `/anthropic/v1/messages` or `/v1/messages`
  suffix. For non-DeepSeek providers (or base URLs without that suffix) set
  `searchBaseUrl` or keep `searchApi: "messages"`.
- `searchApi` is fixed when the plugin loads; `searchBaseUrl`, `count`,
  `needContent`, and `fetch` are read on each call.
- Queries are limited to 1–128 Unicode characters by the native API; the plugin
  rejects longer queries before the request. The messages backend caps queries
  at 8192 characters.
- Billing: direct Search and Fetch calls cost $0.75 per 1,000 successful
  requests each, with 5 QPS per API (Search and Fetch quotas are independent).
  (Server-side tool calls made through
  Harness/Claude Code/Codex are free until 2026-11-01; this plugin's native mode
  calls the APIs directly.) Query operators (`site:`, `-site:`, `"..."`,
  `lang:`, `after:`, `before:`) are passed through unchanged.
- There is no client-side timeout: a slow page can delay a `fetch` call until
  the API's own timeout. Prefer `https` for the base URL; an `http` endpoint
  sends the API key in clear text. Responses are capped at 8 MiB (success) and
  64 KiB (error bodies); requests reject redirects.

### Messages (backward compatibility)

Set `searchApi: "messages"` to keep the legacy Anthropic-compatible backend:
the provider runs the server-side `web_search_20250305` tool and returns a
synthesized answer plus citations. It is also the default for other providers
without a `searchBaseUrl`. `model`, `maxUses`, and `thinking` apply only in
this mode. Use it
when a consumer needs a ready answer, for complex multi-round research, or with
Anthropic.

## Code Mode (execute)

When the runtime exposes the V2 tool API, the plugin also registers
`tools.websearch.search(...)`, so a Code Mode program can run the same search:

```js
const { answer, sources } = await tools.websearch.search({ query: "OpenCode plugins" })
return { answer, top: sources.slice(0, 3).map((s) => s.url) }
```

- The tool is `pinned`, so it stays visible in the Code Mode catalog.
- It declares `permission: "websearch"`; a matching deny rule
  (`{ "action": "websearch", "resource": "*", "effect": "deny" }`) hides it.
- It receives `context.signal`, so cancelling `execute` aborts the request.
- The structured `output` is `{ answer, sources }`; `sources` items carry
  `{ url, title, content }`.
- If the runtime has no `ctx.tool`, the plugin still loads and the built-in
  `websearch` provider keeps working.

## How it works

1. The model calls the built-in `websearch` tool (or a Code Mode program calls
   `tools.websearch.search`).
2. **`native`** (default for DeepSeek, or when `searchBaseUrl` is set): the
   plugin calls `POST /v1/tools/search`, maps the structured results to sources, optionally
   enriches the top N through `POST /v1/tools/fetch`, and returns the sources
   (no synthesized answer).
3. **`searchApi: "messages"`**: the plugin sends the query to the selected
   provider's Anthropic-compatible Messages endpoint with the
   `web_search_20250305` server-side tool enabled. The provider searches and
   writes a synthesized answer; the plugin returns that answer plus the
   de-duplicated source URLs.

## Releases

Releases are automated with [`semantic-release`](https://semantic-release.gitbook.io/)
from [Conventional Commits](https://www.conventionalcommits.org/) merged to
`main`: `fix:` → patch, `feat:` → minor, and breaking changes → minor while
`< 1.0.0`. It publishes to npm via trusted publishing (OIDC) with provenance,
then tags the commit and creates a GitHub Release. See
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Development

```sh
bun install
bun run typecheck   # tsc --noEmit
bun run build       # emits dist/
bun run test        # builds, then runs bun test
bun run test:node   # Node runtime smoke (after build)
bun run lint        # biome check
bun run format      # biome format --write
```

The plugin is a thin wrapper: pure helpers (`buildRequestBody`, `dedupeSources`,
`extractAnswerAndSources`, `mapNativeResults`, `toResults`, `toContent`,
`toSourceObjects`, `resolveApiKey`, `resolveEndpoint`, `resolveModel`,
`resolveProvider`, `resolveSearchApi`, `defaultSearchApi`,
`resolveSearchBaseUrl`, `resolveCount`,
`resolveNeedContent`, `resolveFetchCount`, `resolveMaxUses`, `resolveThinking`)
are exported separately and covered by unit tests with a mocked `fetch`.

### Verify a local package

Build a tarball and install it into a scratch config:

```sh
bun pm pack
mkdir scratch && cd scratch
bun init -y
bun add ../opencode-websearch-deepseek-*.tgz
```

Then point `opencode.jsonc` in that directory at the package and restart
OpenCode:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-websearch-deepseek"]
}
```

## License

[MIT](./LICENSE) © OniVe
