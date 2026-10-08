/**
 * semantic-release configuration.
 *
 * Versioning follows Conventional Commits:
 *   fix:              -> patch
 *   feat:             -> minor
 *   breaking (*!:)    -> minor while < 1.0.0 (see releaseRules below)
 *   chore/ci/docs/... -> no release
 *
 * Publishing uses npm trusted publishing (OIDC), so no npm token is needed
 * and provenance is generated automatically. Release notes live on GitHub
 * Releases.
 */
module.exports = {
  branches: ["main"],
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      {
        releaseRules: [
          // Pre-1.0 policy: a breaking change bumps the minor version.
          // TODO: remove this rule when releasing 1.0.0.
          { breaking: true, release: "minor" },
        ],
      },
    ],
    "@semantic-release/release-notes-generator",
    "@semantic-release/npm",
    "@semantic-release/github",
  ],
}
