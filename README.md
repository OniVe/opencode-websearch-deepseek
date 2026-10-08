# opencode-websearch-deepseek

A [DeepSeek](https://deepseek.com)-powered web search provider for OpenCode's
**built-in** `websearch` tool.

It registers through the OpenCode V2 plugin API (`ctx.websearch.transform`) as a
native search provider, so **no MCP server is required**. Queries are answered
by DeepSeek's Anthropic-compatible Messages API using the server-side
`web_search_20250305` tool; the provider returns a synthesized answer plus the
source URLs it was based on.

- Zero runtime dependencies (uses the global `fetch`).
- Works with any DeepSeek model that supports server-side web search.
- Configurable `max_uses`, thinking mode, and model.

## Requirements

- **OpenCode 2.x** with the V2 plugin API (the `plugins` config field). The
  OpenCode 1.x plugin loader expects the legacy `server()` export and will not
  load this plugin.
- Node.js 22.14+ (for `fetch`; OpenCode's runtime already provides it).
- A DeepSeek API key.

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
  "plugins": ["opencode-websearch-deepseek@0.1.0"]
}
```

Restart the OpenCode service after changing the config:

```sh
opencode service restart
```

## Configure

The plugin reads these environment variables from the environment OpenCode runs
in:

| Variable            | Required | Default            | Description                                                        |
| ------------------- | -------- | ------------------ | ------------------------------------------------------------------ |
| `DEEPSEEK_API_KEY`  | no\*     | —                  | DeepSeek API key (takes precedence over the stored credential).    |
| `WEBSEARCH_API_KEY` | no       | —                  | Fallback env key used when `DEEPSEEK_API_KEY` is not set.          |
| `WEBSEARCH_MODEL`   | no       | `deepseek-v4-flash`| Model used for search and synthesis.                               |
| `WEBSEARCH_MAX_USES`| no       | `5`                | Max server-side searches per query (positive integer).             |
| `WEBSEARCH_THINKING`| no       | `enabled`          | `enabled` or `disabled`; disables extended thinking when set to `disabled`. |

> `WEBSEARCH_MODEL` is passed through as-is. DeepSeek maps unknown model names
> to its default, so any server-side-search-capable DeepSeek model works.

> \* If no environment key is set, the plugin reuses the API key OpenCode
> stores for the `deepseek` provider (for example after `opencode auth login`),
> so no environment variable is required when that provider is already
> authenticated.

### Plugin options

As an alternative to environment variables, configure the plugin with the
`plugins` object form (read from `ctx.options`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-websearch-deepseek",
      "options": {
        "apiKey": "{file:~/.config/opencode/deepseek.key}",
        "model": "deepseek-v4-flash",
        "maxUses": 5,
        "thinking": "enabled"
      }
    }
  ]
}
```

Precedence for the API key: `options.apiKey` → `DEEPSEEK_API_KEY` /
`WEBSEARCH_API_KEY` → stored `deepseek` provider credential. `model`, `maxUses`,
and `thinking` fall back to their environment variables and defaults.
OpenCode interpolates `{file:...}` (and `{env:...}`) in config values, so the
key can live in a file instead of the OS environment.

> The plugin always selects the DeepSeek provider. Without an API key, a
> `websearch` call fails with a clear error rather than silently falling back
> to a different provider.

Once loaded, the provider becomes the default websearch provider, so the model
can use the normal `websearch` tool without any extra configuration.

## How it works

1. The model calls the built-in `websearch` tool.
2. This plugin sends the query to `https://api.deepseek.com/anthropic/v1/messages`
   with the `web_search_20250305` server-side tool enabled.
3. DeepSeek searches, then writes a synthesized answer.
4. The plugin returns that answer plus the de-duplicated source URLs as
   `WebSearch.Result` entries.

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

The plugin is a thin wrapper: pure helpers (`buildRequestBody`,
`dedupeSources`, `extractAnswerAndSources`, `toResults`, `resolveMaxUses`,
`resolveThinking`) are exported separately and covered by unit tests with a
mocked `fetch`.

### Verify a local package

Build a tarball and install it into a scratch config:

```sh
npm pack
mkdir scratch && cd scratch
npm init -y
npm install ../opencode-websearch-deepseek-0.1.0.tgz
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
