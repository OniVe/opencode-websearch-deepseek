# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-07

### Added

- Initial release: a DeepSeek-powered provider for OpenCode's built-in
  `websearch` tool, registered via `ctx.websearch.transform`.
- `max_uses` in the server-side search tool declaration (default `5`,
  overridable with `WEBSEARCH_MAX_USES`).
- `anthropic-version: 2023-06-01` request header.
- `WEBSEARCH_THINKING=enabled|disabled` toggle (enabled by default).
- Source de-duplication by URL.
- Unit tests and CI, plus an npm release workflow.

[Unreleased]: https://github.com/OniVe/opencode-websearch-deepseek/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/OniVe/opencode-websearch-deepseek/releases/tag/v0.1.0
