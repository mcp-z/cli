/**
 * resolve-server-config.ts
 *
 * Shared config resolution for CLI commands.
 * Supports both config file-based and inline server configurations.
 */

import type { McpServerEntry, ServersConfig } from '@mcp-z/client';
import { validateServers } from '@mcp-z/client';
import * as fs from 'fs';
import * as path from 'path';
import type { ServerConfig } from '../types.ts';
import { findConfigPath } from './find-config.ts';

/**
 * Options for inline server configuration.
 */
export interface InlineConfigOptions {
  /** Server name (optional when inline config provided) */
  server?: string;
  /** Config file path (mutually exclusive with inline options) */
  config?: string;
  /** Stdio run command string (e.g., "npx -y @echo/server") */
  run?: string;
  /** HTTP server URL */
  url?: string;
  /** Full server config as JSON string */
  serverConfig?: string;
}

/**
 * Resolved server configuration.
 */
export interface ResolvedServerConfig {
  /** Server name for display purposes */
  serverName: string;
  /** The server configuration object */
  serverConfig: ServerConfig;
  /** Working directory for the server (cwd for inline, config dir for file) */
  configDir: string;
  /** Full servers config (for HTTP auth flow that needs full config) */
  fullConfig: ServersConfig;
}

/**
 * Resolve server configuration from CLI options.
 *
 * Supports three modes:
 * 1. Config file: --config path + server positional
 * 2. Inline stdio: --run "npx server"
 * 3. Inline HTTP: --url "https://..."
 * 4. Full JSON: --server '{"command":"npx",...}'
 *
 * @param opts - CLI options for config resolution
 * @returns Resolved server configuration
 * @throws Error if configuration is invalid
 */
export function resolveServerConfig(opts: InlineConfigOptions): ResolvedServerConfig {
  // Validate mutual exclusivity of inline options
  const inlineOptions = [opts.run, opts.url, opts.serverConfig].filter(Boolean);
  if (inlineOptions.length > 1) {
    throw new Error('Cannot use multiple inline config options. Use only one of: --run, --url, or --server');
  }

  const hasInlineConfig = inlineOptions.length > 0;

  // Validate mutual exclusivity with config file
  if (hasInlineConfig && opts.config) {
    throw new Error('Cannot use --config with inline config options (--run, --url, --server)');
  }

  // Handle inline configuration
  if (hasInlineConfig) {
    return resolveInlineConfig(opts);
  }

  // Handle config file-based configuration
  return resolveFileConfig(opts);
}

/**
 * Resolve inline server configuration.
 */
function resolveInlineConfig(opts: InlineConfigOptions): ResolvedServerConfig {
  const serverName = opts.server || 'inline';
  const configDir = process.cwd();
  let serverConfig: ServerConfig;

  if (opts.run) {
    // Parse run string into command + args (simple helper, no schema validation needed)
    serverConfig = parseRunString(opts.run);
  } else if (opts.url) {
    // Create HTTP server config (simple helper, no schema validation needed)
    serverConfig = {
      type: 'http',
      url: opts.url,
    };
  } else if (opts.serverConfig) {
    // Parse full JSON config with schema validation
    serverConfig = parseServerConfigJson(opts.serverConfig, serverName);
  } else {
    throw new Error('No inline config provided');
  }

  // Create a minimal servers config for the resolved server
  const fullConfig: ServersConfig = {
    [serverName]: serverConfig,
  };

  return {
    serverName,
    serverConfig,
    configDir,
    fullConfig,
  };
}

/**
 * Resolve config file-based server configuration.
 */
function resolveFileConfig(opts: InlineConfigOptions): ResolvedServerConfig {
  if (!opts.server) {
    throw new Error('Server name is required when using config file');
  }

  const cfgPath = findConfigPath(opts.config);
  const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const servers: ServersConfig = raw.mcpServers ?? raw.servers ?? raw;

  const serverNames = Object.keys(servers || {});
  if (!serverNames.includes(opts.server)) {
    throw new Error(`Server '${opts.server}' not found in config\n\nAvailable servers: ${serverNames.join(', ')}`);
  }

  const serverConfig = servers[opts.server];
  if (!serverConfig) {
    throw new Error(`Server ${opts.server} not found in config`);
  }

  return {
    serverName: opts.server,
    serverConfig: serverConfig as ServerConfig,
    configDir: path.dirname(cfgPath),
    fullConfig: servers,
  };
}

/**
 * Parse a run string into a ServerConfigStdio.
 *
 * @example
 * parseRunString("npx -y @echo/server")
 * // => { command: "npx", args: ["-y", "@echo/server"] }
 */
function parseRunString(runStr: string): ServerConfig {
  const parts = runStr.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) {
    throw new Error('Run string cannot be empty');
  }

  return {
    command: parts[0],
    args: parts.slice(1),
  };
}

/**
 * Parse and validate a full server config JSON string against the MCP schema.
 *
 * @example
 * parseServerConfigJson('{"command":"npx","args":["-y","@echo/server"]}')
 * parseServerConfigJson('{"url":"https://example.com/mcp","type":"http"}')
 */
function parseServerConfigJson(jsonStr: string, serverName: string): ServerConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (error) {
    throw new Error(`Failed to parse server config JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Server config must be a JSON object');
  }

  const config = parsed as McpServerEntry;

  // Validate: must have either 'command' (stdio) or 'url' (http)
  if (!config.command && !config.url) {
    throw new Error('Server config must have either "command" (for stdio) or "url" (for http)');
  }

  // Normalize: if url is present without explicit type, set type to 'http'
  if (config.url && !config.type) {
    config.type = 'http';
  }

  // Validate against the MCP servers schema
  const serversMap = { [serverName]: config };
  const validation = validateServers(serversMap);
  if (!validation.valid) {
    const errorDetails = validation.errors?.join('\n  ') || 'Unknown validation error';
    throw new Error(`Invalid server config:\n  ${errorDetails}`);
  }

  // Return as ServerConfig (compatible with McpServerEntry)
  return config as ServerConfig;
}
