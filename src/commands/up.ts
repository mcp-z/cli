import { createServerRegistry, type Dialect, type ServerRegistry } from '@mcp-z/client';
import * as fs from 'fs';
import * as path from 'path';
import findConfigPath from '../lib/find-config-path.ts';
import { hasStartBlock, type ServerConfig } from '../types.ts';

/**
 * Configuration options for the upCommand function
 * @public
 */
export interface UpOptions {
  /** Optional path to custom .mcp.json configuration file */
  config?: string;
  /** Start only stdio servers (Claude Code compatible mode) */
  stdioOnly?: boolean;
  /** Start only HTTP servers with start blocks (for Claude Code Desktop) */
  httpOnly?: boolean;
}

/**
 * MCP server configuration entry per MCP specification.
 *
 * Supports two transport types:
 * - stdio (default if no type): spawned process with stdin/stdout
 * - http: remote HTTP server
 *
 * Transport can be inferred from URL protocol:
 * - http:// or https:// → http
 *
 * @see https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
 */

/**
 * Start a cluster of MCP servers from a configuration file or object.
 *
 * @param opts - Configuration options
 * @param opts.config - Optional path to custom .mcp.json file
 * @returns ServerRegistry with servers map, config, connect method, and close function
 *
 * @example
 * // Auto-discover .mcp.json in current directory
 * const registry = await upCommand();
 *
 * @example
 * // Load from specific config
 * const registry = await upCommand({ config: '/path/to/.mcp.json' });
 *
 * @example
 * // Use in-memory config
 * const registry = await upCommand({
 *   mcpServers: {
 *     'echo-stdio': { command: 'node', args: ['test/lib/servers/echo-stdio.ts'] }
 *   }
 * });
 */
export async function upCommand(opts: UpOptions = {}): Promise<ServerRegistry> {
  const configPath = findConfigPath({ config: opts.config });
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const servers = raw.mcpServers ?? raw.servers ?? raw;
  const configDir = path.dirname(configPath);

  // Determine dialects based on flags
  // Default is ['servers', 'start'] (spawns everything)
  let dialects: Dialect[] = ['servers', 'start'];
  if (opts.stdioOnly) {
    dialects = ['servers'];
  } else if (opts.httpOnly) {
    dialects = ['start'];
    // In http-only mode, check if there are any servers with start blocks
    const hasStartBlocks = Object.values(servers || {}).some((entry) => entry && hasStartBlock(entry as ServerConfig));
    if (!hasStartBlocks) {
      console.log('  No HTTP servers found with start configuration');
      console.log('  (stdio servers are spawned automatically by Claude Code)');
      // Return empty registry
      return createServerRegistry({}, { cwd: configDir });
    }
  }

  return createServerRegistry(servers, {
    cwd: configDir,
    dialects,
  });
}
