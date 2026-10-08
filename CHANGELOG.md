# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Releases after 0.1.0 are published automatically on
> [GitHub Releases](https://github.com/OniVe/opencode-websearch-deepseek/releases);
> this file records the initial release.

## [0.1.0] - 2026-10-07

### Added

- Initial release: a DeepSeek-powered provider for OpenCode's built-in
  `websearch` tool, registered via `ctx.websearch.transform`.
- `max_uses` in the server-side search tool declaration (default `5`,
  overridable with `WEBSEARCH_MAX_USES`).
- `anthropic-version: 2023-06-01` request header.
- `WEBSEARCH_THINKING=enabled|disabled` toggle (enabled by default).
- Source de-duplication by URL, preserving first-seen order.
- Read `citations[].cited_text` snippets into source `content` when present
  (defensive; DeepSeek may not emit them).
- Unit tests (16) and CI, plus npm release tooling.

### Changed

- Send the system prompt as the top-level `system` field (Anthropic contract)
  instead of a `system` role inside `messages`.
- `toResults` is total when `sources` is omitted.
- Minimum supported Node.js is 20 (`engines`), matching CI (raised to
  22.14.0 in a later release).

### Fixed

- `npm pack` builds first via `prepack` (previously packing without a build
  emitted a broken tarball with no `dist/`).
- `extractAnswerAndSources` no longer throws on a non-array `content`; it
  degrades to an empty result.
- `resolveMaxUses` accepts only a plain positive integer (rejects `1e3`,
  `5.5`, `5abc`, and values outside the safe-integer range) and, with
  `resolveThinking`, stays total for non-string input.
- `dedupeSources` drops non-string/empty URLs and merges duplicate URLs.
- `execute` tolerates an omitted context object.
- Cancellation is preserved when reading a non-2xx body (an `AbortError`, or a
  custom `abort(reason)`, is no longer masked as an API error).
- Reject an API key containing control characters before it reaches the
  request headers.

[0.1.0]: https://github.com/OniVe/opencode-websearch-deepseek/releases/tag/v0.1.0
