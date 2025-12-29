// Type definitions for MCP config files

export interface MCPConfiguration {
  mcpServers: Record<string, ServerConfig>;
}

// Stdio server: spawns with stdio transport
export interface ServerConfigStdio {
  type?: 'stdio'; // Optional: absence means stdio
  command: string;
  args?: string[]; // OPTIONAL per .mcp.json standard
  env?: Record<string, string>;
}

// HTTP server: connects to URL, optionally spawns the server locally
export interface ServerConfigHttp {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  start?: ServerConfigStdio; // Extension: reuse stdio config for spawning HTTP servers
}

export type ServerConfig = ServerConfigStdio | ServerConfigHttp;

// Type guards
export function isHttpServer(config: ServerConfig): config is ServerConfigHttp {
  return config.type === 'http';
}

export function isStdioServer(config: ServerConfig): config is ServerConfigStdio {
  return !isHttpServer(config);
}

export function hasStartBlock(config: ServerConfig): config is ServerConfigHttp & { start: ServerConfigStdio } {
  return isHttpServer(config) && config.start !== undefined;
}
