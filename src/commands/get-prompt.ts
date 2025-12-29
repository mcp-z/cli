/**
 * get-prompt.ts
 *
 * Get MCP prompts from the command line.
 * Supports stdio (spawned) and http (remote) servers per MCP spec.
 */

import { createServerRegistry, type ManagedClient, type PromptArguments, type ServerRegistry } from '@mcp-z/client';
import { type InlineConfigOptions, resolveServerConfig } from '../lib/resolve-server-config.ts';
import { isHttpServer } from '../types.ts';

export interface GetPromptOptions extends InlineConfigOptions {
  name: string; // Prompt name (positional)
  args: string; // JSON args (positional)
  json?: boolean; // --json
}

/**
 * Main get-prompt command implementation.
 *
 * @param opts - Get prompt options from CLI flags
 *
 * @example
 * // Get a prompt with JSON args
 * await getPromptCommand({
 *   server: 'assistant',
 *   name: 'compose-email',
 *   args: '{"tone": "formal"}',
 * });
 */
export async function getPromptCommand(opts: GetPromptOptions): Promise<void> {
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

    // 5. Parse prompt arguments
    let promptArgs: PromptArguments | undefined;
    if (opts.args && opts.args !== '{}') {
      try {
        const parsed = JSON.parse(opts.args);
        if (typeof parsed !== 'object' || parsed === null) {
          throw new Error('Arguments must be a JSON object');
        }
        promptArgs = parsed;
      } catch (error) {
        throw new Error(`Failed to parse prompt arguments as JSON: ${error instanceof Error ? error.message : String(error)}\n\nProvided args: ${opts.args}`);
      }
    }

    // 6. Get prompt
    if (!opts.json) {
      console.log(`💬 Getting ${opts.name}...`);
    }

    const promptResponse = await client.getPrompt(opts.name, promptArgs);
    const prompt = promptResponse.raw();

    // Success case
    if (opts.json) {
      // JSON output mode
      console.log(JSON.stringify(prompt, null, 2));
    } else {
      // Human-readable output
      console.log('✅ Get prompt succeeded\n');

      // Display description if available
      if (prompt.description) {
        console.log(`Description: ${prompt.description}\n`);
      }

      // Display messages
      console.log('Messages:');
      for (const message of prompt.messages) {
        console.log(`  [${message.role}]:`);
        if (typeof message.content === 'string') {
          console.log(`    ${message.content}`);
        } else if (message.content.type === 'text') {
          console.log(`    ${message.content.text}`);
        } else if (message.content.type === 'image') {
          console.log(`    [Image: ${message.content.mimeType}]`);
        } else if (message.content.type === 'resource') {
          console.log(`    [Resource: ${message.content.resource.uri}]`);
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
