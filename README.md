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

`start` is an extension used by `npx @mcp-z/cli up` to launch HTTP servers for you.

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

- `legacy` (the default when the flag is absent) — the plain 2025 connect sequence.
- `auto` — probes the server with a `server/discover` request first, connects at the newest revision the server offers, and falls back to the 2025 sequence when the server cannot serve the modern era.
- `2026-07-28` — pins that revision. A server that does not offer it fails the connect with a message suggesting `--protocol auto`, instead of silently downgrading.

**Stall risk with `auto` on stdio servers:** the probe is a regular request, so a legacy server that never answers an unknown pre-`initialize` request (it goes silent rather than replying "method not found") costs the full request timeout — 60 seconds — before the client falls back to the 2025 sequence. The probe ends as soon as the server answers it with *anything*, including a JSON-RPC error, so well-behaved 2025 servers fall back in milliseconds.

## Inline usage

```bash
# Stdio
mcp-z inspect --run "npx -y @modelcontextprotocol/server-everything"

# HTTP
mcp-z inspect --url "https://api.example.com/mcp"
```

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

- Node.js >= 24

### Documentation

[API Docs](https://mcp-z.github.io/cli)
