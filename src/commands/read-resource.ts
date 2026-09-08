/**
 * read-resource.ts
 *
 * Read MCP resources from the command line.
 * Supports stdio (spawned) and http (remote) servers per MCP spec.
 */

import { createServerRegistry, type ManagedClient, type ServerRegistry } from '@mcp-z/client';
import { eraNegotiationError, protocolToVersionNegotiation } from '../lib/protocol.ts';
import { type InlineConfigOptions, resolveServerConfig } from '../lib/resolve-server-config.ts';
import { isHttpServer } from '../types.ts';

export interface ReadResourceOptions extends InlineConfigOptions {
  uri: string; // Resource URI (positional)
  protocol?: string; // --protocol legacy|auto|2026-07-28
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

  // Fail fast on a bad --protocol value, before any server is spawned
  const versionNegotiation = protocolToVersionNegotiation(opts.protocol);

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
    client = await registry.connect(serverName, versionNegotiation !== undefined ? { versionNegotiation } : undefined);

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
    // A pinned connection against a server that cannot serve the revision fails with the
    // SDK's typed era error; surface it as a configuration error with a fix, not a stack
    const err = eraNegotiationError(error) ?? error;
    if (opts.json) {
      console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2));
    } else {
      console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
    }
    throw err;
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
