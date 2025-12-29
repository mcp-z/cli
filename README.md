# @mcp-z/cli

Docs: https://mcp-z.github.io/cli
MCP server lifecycle management and inspection from the command line.

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
