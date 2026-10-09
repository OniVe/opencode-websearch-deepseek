# opencode-websearch-deepseek

A web search provider for OpenCode's **built-in** `websearch` tool, speaking the
Anthropic Messages protocol with the server-side `web_search_20250305` tool.
[DeepSeek](https://deepseek.com) is the default provider (its
Anthropic-compatible endpoint emulates the same protocol); any Anthropic-compatible
endpoint can be selected.

It registers through the OpenCode V2 plugin API (`ctx.websearch.transform`) as a
native search provider, so **no MCP server is required**, and also exposes the
same search to Code Mode as `tools.websearch.search(...)` when the runtime
supports tools. The provider returns a synthesized answer plus the source URLs it
was based on.

- Zero runtime dependencies (uses the global `fetch`).
- Provider presets: `deepseek` (default) and `anthropic`, plus any custom
  Anthropic-compatible endpoint via `baseUrl`.
- Configurable provider, model, `max_uses`, and thinking mode.

## Requirements

- **OpenCode 2.x** with the V2 plugin API (the `plugins` config field). The
  OpenCode 1.x plugin loader expects the legacy `server()` export and will not
  load this plugin.
- Node.js 22.14+ (for `fetch`; OpenCode's runtime already provides it).
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
  "plugins": ["opencode-websearch-deepseek@0.4.0"]
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
        "model": "deepseek-v4-flash",
        "maxUses": 5,
        "thinking": "enabled"
      }
    }
  ]
}
```

| Option      | Default                     | Description                                            |
| ----------- | --------------------------- | ------------------------------------------------------ |
| `provider`  | `deepseek`                  | Preset (`deepseek`, `anthropic`) or any integration id. |
| `baseUrl`   | provider endpoint           | Full Anthropic-compatible `/v1/messages` URL override. |
| `apiKey`    | —                           | API key; takes precedence over env and the credential. |
| `model`     | provider default            | Model used for search and synthesis.                   |
| `maxUses`   | `5`                         | Max server-side searches per query.                    |
| `thinking`  | `enabled`                   | `enabled` or `disabled`.                               |

### Environment variables

| Variable             | Provider  | Description                                          |
| -------------------- | --------- | ---------------------------------------------------- |
| `DEEPSEEK_API_KEY`   | deepseek  | API key for the default provider.                    |
| `ANTHROPIC_API_KEY`  | anthropic | API key for the `anthropic` provider.                |
| `WEBSEARCH_API_KEY`  | any       | Generic fallback API key.                            |
| `WEBSEARCH_MODEL`    | any       | Model override.                                      |
| `WEBSEARCH_MAX_USES` | any       | Max searches per query, positive integer (default 5).|
| `WEBSEARCH_THINKING` | any       | `enabled` (default) or `disabled`.                   |

### Resolution order

- **API key:** `options.apiKey` → provider env var (`DEEPSEEK_API_KEY` /
  `ANTHROPIC_API_KEY`, then `WEBSEARCH_API_KEY`) → credential OpenCode stores for
  the provider's integration (after `opencode auth login`). No key is needed when
  the provider is authenticated in OpenCode.
- **Model:** `options.model` → `WEBSEARCH_MODEL` → OpenCode's default model when
  it belongs to the same provider → provider preset default. Resolved once, when
  the plugin loads.
- **Endpoint:** `options.baseUrl` → provider preset
  (`https://api.deepseek.com/anthropic/v1/messages`,
  `https://api.anthropic.com/v1/messages`).
- **`maxUses` / `thinking`:** option → env var → default.

OpenCode interpolates `{file:...}` (and `{env:...}`) in config values, so the key
can live in a file instead of the OS environment.

> If no key is found, a `websearch` call fails with a clear error rather than
> silently falling back to a different provider.

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
2. The plugin sends the query to the selected provider's Anthropic-compatible
   Messages endpoint with the `web_search_20250305` server-side tool enabled.
3. The provider searches, then writes a synthesized answer.
4. The plugin returns that answer plus the de-duplicated source URLs.

## Releases

Releases are automated with [`semantic-release`](https://semantic-release.gitbook.io/)
from [Conventional Commits](https://www.conventionalcommits.org/) merged to
`main`: `fix:` → patch, `feat:` → minor, and breaking changes → minor while
`< 1.0.0`. It publishes to npm via trusted publishing (OIDC) with provenance,
then tags the commit and creates a GitHub Release. See
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Development

```sh
npm install
npm run typecheck   # tsc --noEmit
npm run build       # emits dist/
npm test            # builds, then runs node --test
```

The plugin is a thin wrapper: pure helpers (`buildRequestBody`, `dedupeSources`,
`extractAnswerAndSources`, `toResults`, `toContent`, `toSourceObjects`,
`resolveApiKey`, `resolveEndpoint`, `resolveModel`, `resolveProvider`,
`resolveMaxUses`, `resolveThinking`) are exported separately and covered by unit
tests with a mocked `fetch`.

### Verify a local package

Build a tarball and install it into a scratch config:

```sh
npm pack
mkdir scratch && cd scratch
npm init -y
npm install ../opencode-websearch-deepseek-*.tgz
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
