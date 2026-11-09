<a id="readme-top"></a>

<!-- PROJECT HEADER -->
<br />
<div align="center">
  <h1 align="center">opencode-websearch-deepseek</h1>

  <p align="center">
    Native DeepSeek Search &amp; Fetch for OpenCode's built-in <code>websearch</code> tool.
    Structured sources by default for DeepSeek; the Anthropic Messages backend remains available for synthesized answers.
    <br />
    <a href="#usage"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="https://github.com/OniVe/opencode-websearch-deepseek/issues/new?labels=bug">Report Bug</a>
    &middot;
    <a href="https://github.com/OniVe/opencode-websearch-deepseek/issues/new?labels=enhancement">Request Feature</a>
  </p>
</div>

<!-- PROJECT SHIELDS -->
[![npm version][npm-version-shield]][npm-version-url]
[![npm downloads][npm-downloads-shield]][npm-downloads-url]
[![CI][ci-shield]][ci-url]
[![License][license-shield]][license-url]
[![Node >=22.14][node-shield]][node-url]
[![Bun 1.4][bun-shield]][bun-url]

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
        <li><a href="#how-it-works">How It Works</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li>
      <a href="#usage">Usage</a>
      <ul>
        <li><a href="#quick-start">Quick Start</a></li>
        <li><a href="#native-search--fetch">Native Search &amp; Fetch</a></li>
        <li><a href="#messages-backward-compatibility">Messages (Backward Compatibility)</a></li>
        <li><a href="#code-mode">Code Mode</a></li>
        <li>
          <a href="#configuration">Configuration</a>
          <ul>
            <li><a href="#plugin-options">Plugin Options</a></li>
            <li><a href="#environment-variables">Environment Variables</a></li>
            <li><a href="#resolution-order">Resolution Order</a></li>
          </ul>
        </li>
      </ul>
    </li>
    <li>
      <a href="#development">Development</a>
      <ul>
        <li><a href="#local-setup">Local Setup</a></li>
        <li><a href="#verify-a-local-package">Verify a Local Package</a></li>
        <li><a href="#releases">Releases</a></li>
      </ul>
    </li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->
## About The Project

OpenCode's built-in `websearch` tool needs a search provider. Without one, the
model cannot reach fresh sources, and standing up a separate search MCP server
adds another process to run, authenticate, and maintain.

This plugin registers directly as a native search provider through the OpenCode
V2 plugin API (`ctx.websearch.transform`), so **no MCP server is required**. It
speaks DeepSeek's JSON Search & Fetch APIs, returns structured sources for the
calling model to synthesize an answer from, and exposes the same search to Code
Mode as `tools.websearch.search(...)` when the runtime supports tools. An
Anthropic Messages backend with the server-side `web_search_20250305` tool
remains available when a ready-made answer is needed.

Here's why:

* **Structured sources by default** — native mode returns ranked `url`, `title`,
  and content, and the calling model writes the answer instead of relying on an
  intermediate synthesis step.
* **No extra service** — the provider lives inside OpenCode's plugin runtime and
  has zero runtime dependencies (it uses the global `fetch`).
* **Two backends, one config** — native DeepSeek Search & Fetch is the default
  for DeepSeek; the legacy Messages backend (server-side `web_search_20250305`)
  remains the default for other providers without a native `searchBaseUrl` and
  can be selected explicitly with `searchApi: "messages"`. Presets cover
  `deepseek` and `anthropic`; custom endpoints use `baseUrl` for Messages or
  `searchBaseUrl` for a DeepSeek-compatible native API.
* **Tunable** — native `count`, `needContent`, and `fetch`; messages `model`,
  `maxUses`, and `thinking`.
* **Available through both surfaces** — the same search works through the
  built-in `websearch` tool and Code Mode, with a pinned tool, a `websearch`
  permission, and abort-signal support.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

* [![OpenCode 2.x][opencode-shield]][opencode-url]
* [![DeepSeek Search & Fetch][deepseek-shield]][deepseek-url]
* [![TypeScript][typescript-shield]][typescript-url]
* [![Bun][bun-shield]][bun-url]
* [![Biome][biome-shield]][biome-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### How It Works

1. The model calls the built-in `websearch` tool (or a Code Mode program calls
   `tools.websearch.search`).
2. **`native`** (default for DeepSeek, or when `searchBaseUrl` is set): the
   plugin calls `POST /v1/tools/search`, maps the structured results to sources,
   optionally enriches the top N through `POST /v1/tools/fetch`, and returns the
   sources (no synthesized answer).
3. **`searchApi: "messages"`**: the plugin sends the query to the selected
   provider's Anthropic-compatible Messages endpoint with the
   `web_search_20250305` server-side tool enabled. The provider searches and
   writes a synthesized answer; the plugin returns that answer plus the
   de-duplicated source URLs.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- GETTING STARTED -->
## Getting Started

Install the plugin into OpenCode 2.x, provide a DeepSeek API key (or sign in
through OpenCode), and the built-in `websearch` tool starts using it.

### Prerequisites

* **OpenCode 2.x** with the V2 plugin API (the `plugins` config field). The
  OpenCode 1.x plugin loader expects the legacy `server()` export and will not
  load this plugin.
* **Node.js 22.14+** at runtime (OpenCode's runtime already provides it).
* **An API key** for the selected provider (DeepSeek by default), or that
  provider authenticated in OpenCode with `opencode auth login`.
* **Bun 1.4+** for development (`bun install`, tests, Biome).

### Installation

#### With the OpenCode CLI

```sh
opencode plugin add opencode-websearch-deepseek
```

#### Manually

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

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- USAGE -->
## Usage

### Quick Start

Enable the plugin in `~/.config/opencode/opencode.json(c)`, restart the service,
and use the built-in `websearch` tool as usual. For DeepSeek the native backend
is the default, so no extra options are required.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-websearch-deepseek"]
}
```

In Code Mode, the same search is available as `tools.websearch.search(...)`:

```js
const { answer, sources } = await tools.websearch.search({ query: "OpenCode plugins" })
return { answer, top: sources.slice(0, 3).map((s) => s.url) }
```

The result shape is `{ answer, sources }`; each source carries
`{ url, title, content }`. In native mode `answer` is `""` and the sources are
the result.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Native Search & Fetch

`native` is the default for DeepSeek, and for any provider when `searchBaseUrl`
is set (unless `searchApi: "messages"` is explicit). It uses DeepSeek's raw JSON
APIs instead of the Messages tool:

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

* `POST /v1/tools/search` returns ranked results (`title`, `url`, `summary`,
  `snippet`, `content`, `date`, `authority`). Each source's `content` is
  `content || summary || snippet`.
* `needContent: true` sets `need_content`, so DeepSeek returns page content in
  the search response.
* `fetch: N` then calls `POST /v1/tools/fetch` for the top N results and
  replaces their content with full page Markdown. Fetch is best effort: the
  search still succeeds if a page cannot be retrieved. Search starts and fetch
  starts are each paced process-wide by about 210 ms (below the 5 QPS limit;
  the Search and Fetch quotas are independent); failures are reported once via
  `console.warn`.
* The native Search API does **not** synthesize an answer, so `answer` is `""`;
  the provider returns the source list and `tools.websearch.search` returns
  `{ answer: "", sources }`. The model reads the source content.
* Only `url`, `title`, and `content` are exposed to the model; `site_name`,
  `site_icon`, `date`, `authority`, and `rerank_score` are present in the API
  response but are not exposed.
* The base URL defaults to `https://api.deepseek.com` and can be overridden with
  `searchBaseUrl` (an origin or path prefix without `/v1`; the `/v1/tools/*`
  suffix is appended, and a `/v1` suffix is rejected). It is also derived from
  a custom `baseUrl` by stripping the `/anthropic/v1/messages` or `/v1/messages`
  suffix. For non-DeepSeek providers (or base URLs without that suffix) set
  `searchBaseUrl` or keep `searchApi: "messages"`.
* `searchApi` is fixed when the plugin loads; `searchBaseUrl`, `count`,
  `needContent`, and `fetch` are read on each call.
* Queries are limited to 1–128 Unicode characters by the native API; the plugin
  rejects longer queries before the request. The messages backend caps queries
  at 8192 characters.
* Billing: direct Search and Fetch calls cost $0.75 per 1,000 successful
  requests each, with 5 QPS per API (Search and Fetch quotas are independent).
  Server-side tool calls made through Harness/Claude Code/Codex follow those
  products' terms; this plugin's native mode calls the APIs directly. Query
  operators (`site:`, `-site:`, `"..."`, `lang:`, `after:`, `before:`) are
  passed through unchanged.
* There is no client-side timeout: a slow page can delay a `fetch` call until
  the API's own timeout. Prefer `https` for the base URL; an `http` endpoint
  sends the API key in clear text. Responses are capped at 8 MiB (success) and
  64 KiB (error bodies); requests reject redirects.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Messages (Backward Compatibility)

Set `searchApi: "messages"` to keep the legacy Anthropic-compatible backend:
the provider runs the server-side `web_search_20250305` tool and returns a
synthesized answer plus citations. It is also the default for other providers
without a `searchBaseUrl`. `model`, `maxUses`, and `thinking` apply only in
this mode. Use it when a consumer needs a ready answer, for complex multi-round
research, or with Anthropic.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Code Mode

When the runtime exposes the V2 tool API, the plugin also registers
`tools.websearch.search(...)`, so a Code Mode program can run the same search:

```js
const { answer, sources } = await tools.websearch.search({ query: "OpenCode plugins" })
return { answer, top: sources.slice(0, 3).map((s) => s.url) }
```

* The tool is `pinned`, so it stays visible in the Code Mode catalog.
* It declares `permission: "websearch"`; a matching deny rule
  (`{ "action": "websearch", "resource": "*", "effect": "deny" }`) hides it.
* It receives `context.signal`, so cancelling `execute` aborts the request.
* The structured `output` is `{ answer, sources }`; `sources` items carry
  `{ url, title, content }`.
* If the runtime has no `ctx.tool`, the plugin still loads and the built-in
  `websearch` provider keeps working.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Configuration

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

#### Plugin Options

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
for any provider and takes priority over `baseUrl`. Otherwise `native` is used
for `deepseek` unless a custom `baseUrl` (Messages endpoint) is configured, and
`messages` is used for other providers.

`count`, `needContent`, and `fetch` are ignored in `messages` mode.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

#### Environment Variables

| Variable                    | Provider  | Description                                           |
| --------------------------- | --------- | ----------------------------------------------------- |
| `DEEPSEEK_API_KEY`          | deepseek  | API key for the default provider.                     |
| `ANTHROPIC_API_KEY`         | anthropic | API key for the `anthropic` provider.                 |
| `WEBSEARCH_API_KEY`         | any       | Generic fallback API key.                             |
| `WEBSEARCH_MODEL`           | any       | Model override (`messages`).                          |
| `WEBSEARCH_MAX_USES`        | any       | Max searches per query, positive integer (default 5). |
| `WEBSEARCH_THINKING`        | any       | `enabled` (default) or `disabled`.                    |
| `WEBSEARCH_SEARCH_API`      | any       | `native` (default for deepseek) or `messages`.        |
| `WEBSEARCH_SEARCH_BASE_URL` | any       | Base URL for the native Search & Fetch APIs.          |
| `WEBSEARCH_COUNT`           | native    | Results per native search (1–50, default 10).         |
| `WEBSEARCH_NEED_CONTENT`    | native    | `true` to request page content.                       |
| `WEBSEARCH_FETCH`           | native    | Fetch full Markdown for the top N results (default 0).|

<p align="right">(<a href="#readme-top">back to top</a>)</p>

#### Resolution Order

* **API key:** `options.apiKey` → provider env var (`DEEPSEEK_API_KEY` /
  `ANTHROPIC_API_KEY`, then `WEBSEARCH_API_KEY`) → credential OpenCode stores
  for the provider's integration (after `opencode auth login`). No key is
  needed when the provider is authenticated in OpenCode.
* **Model:** `options.model` → `WEBSEARCH_MODEL` → OpenCode's default model when
  it belongs to the same provider → provider preset default. Resolved once with
  a 2 s startup budget; on timeout the preset is used immediately and a
  background refresh updates it. Providers without a preset wait up to 2 s on
  the first search, then retry with a cooldown.
* **Endpoint:** `options.baseUrl` → provider preset
  (`https://api.deepseek.com/anthropic/v1/messages`,
  `https://api.anthropic.com/v1/messages`).
* **`maxUses` / `thinking`:** option → env var → default.
* **`searchApi`:** option → `WEBSEARCH_SEARCH_API` → `native` when
  `searchBaseUrl` is set; otherwise `native` for `deepseek` unless a custom
  `baseUrl` is set; `messages` for other providers.
* **Native base URL:** `options.searchBaseUrl` → env → derived from `baseUrl`
  by stripping its `/anthropic/v1/messages` or `/v1/messages` suffix (otherwise
  set `searchBaseUrl`) → `https://api.deepseek.com`.
* **`count` / `needContent` / `fetch`:** option → env var → default.

OpenCode interpolates `{file:...}` (and `{env:...}`) in config values, so the
key can live in a file instead of the OS environment.

> If no key is found, a `websearch` call fails with a clear error rather than
> silently falling back to a different provider.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- DEVELOPMENT -->
## Development

### Local Setup

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
`resolveSearchBaseUrl`, `resolveCount`, `resolveNeedContent`,
`resolveFetchCount`, `resolveMaxUses`, `resolveThinking`) are exported
separately and covered by unit tests with a mocked `fetch`.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Verify a Local Package

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

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Releases

Releases are automated with [`semantic-release`][semantic-release-url] from
[Conventional Commits][conventional-commits-url] merged to `main`: `fix:` →
patch, `feat:` → minor, and breaking changes → minor while `< 1.0.0`. It
publishes to npm via trusted publishing (OIDC) with provenance, then tags the
commit and creates a GitHub Release. See [CONTRIBUTING.md][contributing-url].

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ROADMAP -->
## Roadmap

- [x] Native DeepSeek Search & Fetch backend
- [x] Native as the default for DeepSeek
- [x] Bun and Biome development toolchain
- [ ] Optional client-side timeout for native Fetch
- [ ] Retry/backoff for `429` and `5xx` responses

Candidate work — not a release commitment. Open an issue to discuss priorities.

See the [open issues][issues-url] for a full list of proposed features (and
known issues).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTRIBUTING -->
## Contributing

Contributions are what make the open source community such an amazing place to
learn, inspire, and create. Any contributions you make are **greatly
appreciated**.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes using [Conventional Commits][conventional-commits-url]
   (`git commit -m 'feat: add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

Before opening a PR, install dependencies and run the checks:

```sh
bun install
bun run test
bun run lint
```

Read [CONTRIBUTING.md][contributing-url] for commit conventions and release
details.

### Top contributors

<a href="https://github.com/OniVe/opencode-websearch-deepseek/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=OniVe/opencode-websearch-deepseek" alt="contrib.rocks image" />
</a>

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- LICENSE -->
## License

Distributed under the MIT License. See [LICENSE][license-url] for more
information. © OniVe.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTACT -->
## Contact

Project Link: [https://github.com/OniVe/opencode-websearch-deepseek][repo-url]

Maintainer: [OniVe](https://github.com/OniVe)

Issues: [https://github.com/OniVe/opencode-websearch-deepseek/issues][issues-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

* [OpenCode][opencode-url] — plugin API and the built-in `websearch` tool.
* [DeepSeek API docs][deepseek-url] — Search & Fetch reference.
* [Anthropic Messages API][anthropic-url] — the `web_search_20250305` server tool.
* [Best-README-Template][best-readme-url] — README layout inspiration.
* [shields.io][shields-url] — badges.
* [contrib.rocks][contrib-rocks-url] — contributor image.
* [Bun][bun-url] and [Biome][biome-url] — runtime and tooling.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->
[npm-version-shield]: https://img.shields.io/npm/v/opencode-websearch-deepseek?style=for-the-badge
[npm-version-url]: https://www.npmjs.com/package/opencode-websearch-deepseek
[npm-downloads-shield]: https://img.shields.io/npm/dm/opencode-websearch-deepseek?style=for-the-badge
[npm-downloads-url]: https://www.npmjs.com/package/opencode-websearch-deepseek
[ci-shield]: https://img.shields.io/github/actions/workflow/status/OniVe/opencode-websearch-deepseek/ci.yml?style=for-the-badge
[ci-url]: https://github.com/OniVe/opencode-websearch-deepseek/actions/workflows/ci.yml
[license-shield]: https://img.shields.io/github/license/OniVe/opencode-websearch-deepseek?style=for-the-badge
[license-url]: https://github.com/OniVe/opencode-websearch-deepseek/blob/main/LICENSE
[node-shield]: https://img.shields.io/badge/node-%3E%3D22.14-339933?style=for-the-badge&logo=nodedotjs&logoColor=white
[node-url]: https://nodejs.org/
[bun-shield]: https://img.shields.io/badge/bun-1.4-FBF0DF?style=for-the-badge&logo=bun&logoColor=black
[bun-url]: https://bun.sh/
[opencode-shield]: https://img.shields.io/badge/OpenCode-2.x-000000?style=for-the-badge
[opencode-url]: https://opencode.ai/docs/plugins
[deepseek-shield]: https://img.shields.io/badge/DeepSeek-Search%20%26%20Fetch-4D6BFE?style=for-the-badge
[deepseek-url]: https://api-docs.deepseek.com/api/search
[typescript-shield]: https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[typescript-url]: https://www.typescriptlang.org/
[biome-shield]: https://img.shields.io/badge/Biome-2.5-60A5FA?style=for-the-badge&logo=biome&logoColor=white
[biome-url]: https://biomejs.dev/
[repo-url]: https://github.com/OniVe/opencode-websearch-deepseek
[issues-url]: https://github.com/OniVe/opencode-websearch-deepseek/issues
[contributing-url]: ./CONTRIBUTING.md
[anthropic-url]: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/web-search-tool
[semantic-release-url]: https://semantic-release.gitbook.io/
[conventional-commits-url]: https://www.conventionalcommits.org/
[best-readme-url]: https://github.com/othneildrew/Best-README-Template
[shields-url]: https://shields.io
[contrib-rocks-url]: https://contrib.rocks
