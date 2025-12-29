/**
 * read-resource.ts
 *
 * Read MCP resources from the command line.
 * Supports stdio (spawned) and http (remote) servers per MCP spec.
 */

import { createServerRegistry, type ManagedClient, type ServerRegistry } from '@mcp-z/client';
import { type InlineConfigOptions, resolveServerConfig } from '../lib/resolve-server-config.ts';
import { isHttpServer } from '../types.ts';

export interface ReadResourceOptions extends InlineConfigOptions {
  uri: string; // Resource URI (positional)
  json?: boolean; // --json
}

/**
 * Main read-resource command implementation.
 *
 * @param opts - Read resource options from CLI flags
 *
 * @example
 * // Read a resource by URI
 * await readResourceCommand({
 *   server: 'gmail',
 *   uri: 'gmail://messages/abc123',
 * });
 */
export async function readResourceCommand(opts: ReadResourceOptions): Promise<void> {
  let registry: ServerRegistry | undefined;
  let client: ManagedClient | undefined;

  try {
    // 1. Resolve server configuration (from config file or inline options)
    const { serverName, serverConfig, configDir } = resolveServerConfig(opts);

    // 2. Create registry and connect
    const start = Date.now();

    if (isHttpServer(serverConfig)) {
      // HTTP server - no spawning needed
      if (!opts.json) {
        console.log(`🔗 Connecting to ${serverName}...`);
      }
    } else {
      // Stdio server - will be spawned
      if (!opts.json) {
        console.log(`🚀 Spawning ${serverName} server...`);
      }

      if (!serverConfig.command) {
        throw new Error(`Stdio server ${serverName} missing required "command" field`);
      }
    }

    // Create registry (spawns stdio servers, registers HTTP servers)
    registry = createServerRegistry({ [serverName]: serverConfig }, { cwd: configDir });
    client = await registry.connect(serverName);

    if (!isHttpServer(serverConfig) && !opts.json) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`✓ Server ready in ${elapsed}s\n`);
    }

    // 5. Read resource
    if (!opts.json) {
      console.log(`📖 Reading ${opts.uri}...`);
    }

    const resourceResponse = await client.readResource(opts.uri);
    const resource = resourceResponse.raw();

    // Success case
    if (opts.json) {
      // JSON output mode
      console.log(JSON.stringify(resource, null, 2));
    } else {
      // Human-readable output
      console.log('✅ Read succeeded\n');

      // Display contents
      for (const content of resource.contents) {
        if ('text' in content) {
          console.log('Content:');
          console.log(content.text);
        } else if ('blob' in content) {
          console.log(`Blob content (${content.mimeType || 'unknown type'}): ${content.blob.length} bytes`);
        }
      }
    }
  } catch (error) {
    if (opts.json) {
      console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));
    } else {
      console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
    }
    throw error;
  } finally {
    // 7. Cleanup - registry.close() handles both client and server close
    if (registry) {
      try {
        await registry.close();
      } catch (_) {
        // Ignore close errors
      }
    }
  }
}
