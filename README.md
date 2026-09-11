# @mcp-z/cli

CLI tool for managing MCP server clusters and testing workflows.

## Common uses

- Spawn servers from `.mcp.json`
- Inspect tools, resources, prompts, and health
- Call tools, prompts, and resources directly
- Search capabilities across servers
- Generate or validate `server.json`

## Install

```bash
npm install -g @mcp-z/cli
```

Use `mcp-z` or its alias `z`, or run without a global install with `npx -y @mcp-z/cli` followed by the same arguments.

## Use from a coding agent

Reuse a project's `.mcp.json` from a shell-capable coding agent without writing a client script or configuring that agent's native MCP integration. Start with the server you need:

```sh
mcp-z inspect --servers SERVER --tools
mcp-z inspect --servers SERVER --tools --json
mcp-z call-tool SERVER TOOL '{"argument":"value"}' --json
```

Replace `SERVER`, `TOOL`, and the illustrative JSON with your configured server and its discovered schema. The first inspection is a readable overview; request the full JSON schema when composing an unfamiliar call. These examples use POSIX shell quoting. The [mcp-z-cli skill](skills/mcp-z-cli/SKILL.md) covers discovery, output selection, argument handling, provider operations, prompts, and resources through task-specific examples.

Without `--config`, lookup starts in the current working directory and uses the nearest `.mcp.json`, searching upward through the home directory inclusive. Outside the home directory tree, it checks only the current directory. Spawned servers use the config directory as their working directory. For alternate configs, `--config .mcp.staging.json` searches upward by filename, while `--config ./.mcp.staging.json` selects that exact path.

### Context on demand

Agents can search capability names, inspect the needed schemas, and save large responses for local filtering instead of loading every definition and intermediate result into context. Human-readable output is the default; `--json` preserves structured output for inspection or processing but is not inherently smaller. This controls model context, not necessarily server startup.

Claude Code also supports deferred tool discovery through MCP Tool Search, configured with `ENABLE_TOOL_SEARCH`. See its [current tool-search documentation](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search) for defaults and provider limitations. The CLI provides a shell-based route using the same project configuration pattern, independent of an agent's native tool-search implementation.

Background on these design principles:

- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [Advanced tool use and on-demand tool discovery](https://www.anthropic.com/engineering/advanced-tool-use)

## Quick start

### Stdio servers

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["path/to/server.js"]
    }
  }
}
```

```bash
mcp-z up
```

### HTTP servers

```json
{
  "mcpServers": {
    "my-server": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

```bash
mcp-z up
```

### HTTP + start block (extension)

```json
{
  "mcpServers": {
    "my-server": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "start": {
        "command": "node",
        "args": ["path/to/http-server.js"]
      }
    }
  }
}
```

`start` is an extension used by `npx @mcp-z/cli up` to launch HTTP servers for you. The `up` command uses the configuration lookup described above unless you pass an explicit config path.

## Commands

### `mcp-z up`

Start MCP servers from `.mcp.json`.

Common use cases:
- Start stdio servers for local development
- Start HTTP servers with `start` blocks

### `mcp-z inspect`

Inspect tools, resources, prompts, and health.

Common use cases:
- See what a server exposes before writing code
- Debug startup issues

### `mcp-z call-tool`

Call a tool with JSON arguments.

Common use cases:
- Test a tool without writing code
- Script quick one-offs

### `mcp-z get-prompt`

Get a prompt with optional JSON arguments.

Common use cases:
- Preview prompt outputs
- Validate prompt arguments

### `mcp-z read-resource`

Read a resource by URI.

Common use cases:
- Fetch file-backed resources
- Verify resource handlers

### `mcp-z search`

Search tools, prompts, and resources across servers.

Common use cases:
- Discover capabilities by keyword
- Find the right tool in multi-server setups

### `mcp-z manifest`

Generate or validate `server.json`.

Common use cases:
- Author or validate MCP server manifests

## Protocol version (`--protocol`)

Every command that connects to a server (`inspect`, `call-tool`, `read-resource`, `get-prompt`, `search`) accepts:

```
--protocol <legacy|auto|2026-07-28>
```

- `legacy` (the default when the flag is absent) uses the plain 2025 connect sequence.
- `auto` probes the server with a `server/discover` request first, connects at the newest revision the server offers, and falls back to the 2025 sequence when the server cannot serve the modern era.
- `2026-07-28` pins that revision. A server that does not offer it fails the connect with a message suggesting `--protocol auto`, instead of silently downgrading.

With `auto` on stdio servers, the probe is a regular request. A legacy server that never answers an unknown pre-`initialize` request costs the full 60-second request timeout before the client falls back to the 2025 sequence. Any response, including a JSON-RPC error, ends the probe, so well-behaved 2025 servers fall back in milliseconds.

## Run without a config file

```bash
mcp-z call-tool local echo '{"message":"hello"}' \
  --run "npx -y @modelcontextprotocol/server-everything"
```

The command starts the server, prints the echoed message, and closes the connection.

## Configuration

MCP server config supports stdio and HTTP.

**Stdio**
```json
{
  "command": "node",
  "args": ["server.js"],
  "env": { "LOG_LEVEL": "info" }
}
```

**HTTP**
```json
{
  "type": "http",
  "url": "http://localhost:3000/mcp",
  "headers": { "Authorization": "Bearer token" }
}
```

## Requirements

- Node.js >= 20

## Documentation

[API Docs](https://mcp-z.github.io/cli)
