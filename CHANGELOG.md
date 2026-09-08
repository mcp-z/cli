# Changelog

## [1.2.0] - 2026-09-07

### Added

- **`--protocol <legacy|auto|2026-07-28>` on every command that connects to a server** (`inspect`, `call-tool`, `read-resource`, `get-prompt`, `search`). Without the flag, or with `legacy`, the client performs the plain 2025 connect sequence, exactly as before. `auto` probes the server with a `server/discover` request first and connects at the newest revision the server offers, falling back to the 2025 sequence when the server cannot serve the modern era. `2026-07-28` pins that revision: a server that does not offer it fails the connect instead of silently downgrading.
- A friendly failure for a pinned connection that the server cannot serve — "The server does not speak protocol revision 2026-07-28 … Try `--protocol auto` …" — instead of the SDK's wire-level error. An invalid `--protocol` value fails immediately, naming the accepted ones.
- Library exports for the same mapping: `protocolToVersionNegotiation()`, `eraNegotiationError()`, `PROTOCOL_VALUES`, and the `ProtocolValue` type, for callers that drive the commands programmatically.

### Changed

- `--protocol` requires `@mcp-z/client` 2.2.0, which added the negotiation connect option; the declared range `^2.0.0` already permits it, so `package.json` is unchanged. Without the flag, every command behaves exactly as in 1.1.3.

## [1.1.3] - 2026-09-01

Documentation-only release: README formatting for consistency and clarity.

## [1.1.2] - 2026-09-01

### Changed

- Usage errors and failed commands now exit with a dedicated error code (23) instead of inheriting whatever the argument parser or the error path produced.

## [1.1.1] - 2026-09-01

### Changed

- The CLI no longer uses commander. Argument parsing is now strict — an unknown flag is a usage error naming the command's usage line — and each command's module loads only when that command runs, so unrelated dependencies no longer slow down startup.

## [1.1.0] - 2026-09-01

Internal-only release: test scripts refactored and `.depcheckrc` updated. No consumer-visible changes.

## [1.0.8] - 2026-09-01

Internal-only release: `@mcp-z/client` dependency upgrade and `get-port` pinned.

## [1.0.7] - 2026-09-01

### Changed

- `manifest generate` transport-type handling improved, and the `@mcp-z/client` dependency moved to 1.0.8.

## [1.0.6] - 2026-09-01

### Removed

- `manifest generate` no longer emits the streamable-http transport entry.

## [1.0.5] - 2026-09-01

### Fixed

- Config file lookup fixed: `inspect`, `search`, and `up` now resolve the config through a single `find-config-path` helper instead of divergent per-command logic.

## [1.0.4] - 2026-09-01

Internal-only release: build warnings fixed.

## [1.0.3] - 2026-09-01

### Changed

- `engines.node` raised to `>=20`.

## [1.0.2] - 2026-09-01

Internal-only release: dependency upgrades.

## [1.0.1] - 2026-09-01

### Added

- The command functions (`callToolCommand`, `getPromptCommand`, `inspectCommand`, `readResourceCommand`) are now exported from the package entry, so scripts can drive the CLI programmatically without spawning a process.

### Changed

- Path resolution refactored.

## [1.0.0] - 2025-12-29

Initial release.
