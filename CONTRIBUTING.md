# Contributing to @mcp-z/cli

CLI tool for managing MCP server clusters and testing workflows.

## Before Starting

A few conventions here differ from what you might expect:

- **Breaking changes over compatibility.** This project has no compatibility burden yet. Do not add back-compat layers, migration utilities, or wrappers for deprecated APIs - change the API cleanly and bump the major.
- **Keep it approachable.** This is a small community project, not an enterprise codebase. Prefer the simplest solution that fits in the existing files over new abstractions, frameworks, or shared infrastructure.
- **Tests use real components, not mocks.** Prefer exercising the real thing over standing up a fake.
- **Test scratch goes in the package's gitignored `.tmp/`**, never `os.tmpdir()`.

## Pre-Commit Commands

Install ts-dev-stack globally if not already installed:

```bash
npm install -g ts-dev-stack
```

Run before committing - this builds, type-checks, lints, and tests:

```bash
tsds validate
```

`tsds validate` also runs automatically on `npm publish` via the `prepublishOnly` hook; a failure blocks the publish.

## Testing

```bash
npm test              # Run the test suite
npm run test:engines  # Run the suite across every supported Node version
```

Specs live in `test/unit/`, mirroring `src/`. Cross-service specs live in `test/integration/`. Both run under `npm test`.

## Package Development

See `README.md` for package overview and usage.

## GitHub Actions

CI follows the Linux/Windows template used by each-package: Node 26, `npm ci`, `prepublishOnly`, a current-runtime test run, and the supported-engine sweep. macOS coverage runs locally. Pull requests receive no provider credentials.

`npm run test:ci` and `npm run test:ci:engines` run the credential-free selection. They select the same tests as the normal scripts.

`npm test` and `npm run test:engines` retain full discovery. CI sets `TEST_INCLUDE_MANUAL=false`; consent tests require a person and run locally with `TEST_INCLUDE_MANUAL=true`. A green credential-free check does not certify live-provider behavior. Release evidence must include the configured live suites and relevant manual OAuth flows.
