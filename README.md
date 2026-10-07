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
- Node.js 18+ (for `fetch`; OpenCode's runtime already provides it).
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
| `DEEPSEEK_API_KEY`  | yes      | —                  | DeepSeek API key.                                                  |
| `WEBSEARCH_API_KEY` | no       | —                  | Fallback key used when `DEEPSEEK_API_KEY` is not set.              |
| `WEBSEARCH_MODEL`   | no       | `deepseek-v4-flash`| Model used for search and synthesis.                               |
| `WEBSEARCH_MAX_USES`| no       | `5`                | Max server-side searches per query (positive integer).             |
| `WEBSEARCH_THINKING`| no       | `enabled`          | `enabled` or `disabled`; disables extended thinking when set to `disabled`. |

Once loaded, the provider becomes the default websearch provider, so the model
can use the normal `websearch` tool without any extra configuration.

## How it works

1. The model calls the built-in `websearch` tool.
2. This plugin sends the query to `https://api.deepseek.com/anthropic/v1/messages`
   with the `web_search_20250305` server-side tool enabled.
3. DeepSeek searches, then writes a synthesized answer.
4. The plugin returns that answer plus the de-duplicated source URLs as
   `WebSearch.Result` entries.

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

[MIT](./LICENSE) © onive
