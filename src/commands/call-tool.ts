/**
 * call-tool.ts
 *
 * Execute MCP tools from the command line.
 * Supports stdio (spawned) and http (remote) servers per MCP spec.
 */

import { createServerRegistry, type ManagedClient, type ServerRegistry, type ToolArguments, ToolResponseError, type ToolResponseWrapper } from '@mcp-z/client';
import { eraNegotiationError, protocolToVersionNegotiation } from '../lib/protocol.ts';
import { type InlineConfigOptions, resolveServerConfig } from '../lib/resolve-server-config.ts';
import { isHttpServer } from '../types.ts';

export interface CallToolOptions extends InlineConfigOptions {
  tool: string; // Tool name (positional)
  args: string; // JSON args (positional)
  protocol?: string; // --protocol legacy|auto|2026-07-28
  json?: boolean; // --json
}

/**
 * Main call-tool command implementation.
 *
 * @param opts - Call tool options from CLI flags
 *
 * @example
 * // Call a tool with JSON args
 * await callToolCommand({
 *   server: 'echo',
 *   tool: 'echo',
 *   args: '{"message": "hello"}',
 * });
 */
export async function callToolCommand(opts: CallToolOptions): Promise<void> {
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

    // 5. Parse tool arguments
    let toolArgs: ToolArguments;
    try {
      const parsed = JSON.parse(opts.args);
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Arguments must be a JSON object');
      }
      toolArgs = parsed;
    } catch (error) {
      throw new Error(`Failed to parse tool arguments as JSON: ${error instanceof Error ? error.message : String(error)}\n\nProvided args: ${opts.args}`);
    }

    // 6. Execute tool
    if (!opts.json) {
      console.log(`🔧 Calling ${opts.tool}...`);
    }

    let response: ToolResponseWrapper;
    try {
      response = await client.callTool(opts.tool, toolArgs);
    } catch (error) {
      handleToolError(error, opts);
      throw error;
    }

    const parsedResult = parseToolResult(response);

    if (parsedResult !== undefined) {
      // Success case
      if (opts.json) {
        // JSON output mode
        console.log(JSON.stringify(parsedResult, null, 2));
      } else {
        // Human-readable output
        console.log(`✅ ${opts.tool} succeeded\n`);
        console.log('Result:');
        if (typeof parsedResult === 'string') {
          console.log(parsedResult);
        } else {
          console.log(JSON.stringify(parsedResult, null, 2));
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
    // 8. Cleanup - registry.close() handles both client and server close
    if (registry) {
      try {
        await registry.close();
      } catch (_) {
        // Ignore close errors
      }
    }
  }
}

function handleToolError(error: unknown, opts: CallToolOptions): void {
  if (!(error instanceof ToolResponseError)) {
    return;
  }

  const errorText = extractToolErrorText(error) || error.message;

  if (opts.json) {
    console.log(JSON.stringify({ error: errorText }, null, 2));
  } else {
    console.log(`❌ ${opts.tool} failed\n`);
    console.log(`Error: ${errorText}`);
  }
}

function extractToolErrorText(error: ToolResponseError): string | undefined {
  const content = Array.isArray(error.response.content) ? error.response.content : [];
  const first = content[0] as { type?: string; text?: unknown } | undefined;
  if (first?.type === 'text' && typeof first.text === 'string') {
    return first.text;
  }
  return undefined;
}

function parseToolResult(response: ToolResponseWrapper): unknown | undefined {
  try {
    return response.json();
  } catch (error) {
    if (error instanceof ToolResponseError) {
      if ('isError' in error.response && error.response.isError) {
        throw error;
      }
      try {
        return response.text();
      } catch {
        return undefined;
      }
    }
    throw error;
  }
}
