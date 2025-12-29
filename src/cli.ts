import { Command } from 'commander';
import * as fs from 'fs';
import moduleRoot from 'module-root-sync';
import * as path from 'path';
import * as url from 'url';
import { type CallToolOptions, callToolCommand } from './commands/call-tool.ts';
import { type GetPromptOptions, getPromptCommand } from './commands/get-prompt.ts';
import { inspectCommand } from './commands/inspect.ts';
import { createManifestCommand } from './commands/manifest/index.ts';
import { type ReadResourceOptions, readResourceCommand } from './commands/read-resource.ts';
import { searchCommand } from './commands/search.ts';
import { upCommand } from './commands/up.ts';

const pkg = JSON.parse(fs.readFileSync(path.join(moduleRoot(url.fileURLToPath(import.meta.url)), 'package.json'), 'utf-8'));

export default function cli(argv: string[], programName: string) {
  const program = new Command();
  program.name(programName).description('mcp-z helper CLI').version(pkg.version);

  program
    .command('up')
    .description('Start MCP server cluster (starts all servers by default)')
    .option('--config <path>', 'Config file path (searches up to home directory)')
    .option('--stdio-only', 'Start only stdio servers (Claude Code compatible)')
    .option('--http-only', 'Start only HTTP servers with start blocks (Claude Code Desktop)')
    .action(async (options) => {
      try {
        const clusterResult = await upCommand({ config: options.config, stdioOnly: options.stdioOnly, httpOnly: options.httpOnly });

        // If httpOnly mode and no servers were spawned, exit immediately
        if (options.httpOnly && clusterResult.servers.size === 0) process.exit(0);

        const shutdown = async (sig: string) => {
          console.log('Shutting down (signal=', sig, ')');
          if (clusterResult && typeof clusterResult.close === 'function') {
            try {
              await clusterResult.close(sig === 'SIGTERM' ? 'SIGTERM' : 'SIGINT', { timeoutMs: 1000 });
            } catch (_) {
              /* ignore */
            }
          }
          process.exit(0);
        };

        // Signal handlers trigger async shutdown then exit
        process.on('SIGINT', () => {
          shutdown('SIGINT').catch(() => process.exit(1));
        });
        process.on('SIGTERM', () => {
          shutdown('SIGTERM').catch(() => process.exit(1));
        });

        // Keep process alive - wait for signal
        await new Promise(() => {});
      } catch (error) {
        console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  program
    .command('inspect')
    .description('Inspect MCP servers: explore tools, resources, prompts, and health status')
    .option('--config <path>', 'Config file path (searches up to home directory)')
    .option('--servers <list>', 'Comma-separated server names to inspect')
    .option('--tools', 'Show tools only')
    .option('--resources', 'Show resources only')
    .option('--prompts', 'Show prompts only')
    .option('--health', 'Show health diagnostics only')
    .option('--json', 'Output as JSON')
    .option('--verbose', 'Include detailed schemas')
    .option('--attach', 'Connect to running servers (default: spawn servers)')
    .action(async (options) => {
      try {
        await inspectCommand({ config: options.config, servers: options.servers, tools: options.tools, resources: options.resources, prompts: options.prompts, health: options.health, json: options.json, verbose: options.verbose, attach: options.attach });
      } catch (error) {
        console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  program
    .command('call-tool [server] <tool> <args>')
    .description('Execute an MCP tool with JSON arguments')
    .option('--config <path>', 'Custom config file path (default: .mcp.json)')
    .option('--run <cmd>', 'Stdio run command (e.g., "npx -y @echo/server")')
    .option('--url <url>', 'HTTP server URL')
    .option('--server <json>', 'Full server config as JSON')
    .option('--json', 'Output as JSON')
    .action(async (server: string | undefined, tool: string, args: string, options: Omit<CallToolOptions, 'server' | 'tool' | 'args'> & { server?: string; run?: string }) => {
      // Handle case where server is actually the tool when using inline config
      // Commander parses: call-tool [server] <tool> <args>
      // With --run: server=undefined, tool=actualTool, args=actualArgs
      // Without --run: server=serverName, tool=actualTool, args=actualArgs
      const opts: CallToolOptions = {
        server,
        tool,
        args,
        ...options,
        run: options.run,
        serverConfig: options.server, // Rename --server to serverConfig to avoid conflict
      };
      await callToolCommand(opts);
    });

  program
    .command('read-resource [server] <uri>')
    .description('Read an MCP resource by URI')
    .option('--config <path>', 'Custom config file path (default: .mcp.json)')
    .option('--run <cmd>', 'Stdio run command (e.g., "npx -y @echo/server")')
    .option('--url <url>', 'HTTP server URL')
    .option('--server <json>', 'Full server config as JSON')
    .option('--json', 'Output as JSON')
    .action(async (server: string | undefined, uri: string, options: Omit<ReadResourceOptions, 'server' | 'uri'> & { server?: string; run?: string }) => {
      const opts: ReadResourceOptions = {
        server,
        uri,
        ...options,
        run: options.run,
        serverConfig: options.server, // Rename --server to serverConfig to avoid conflict
      };
      await readResourceCommand(opts);
    });

  program
    .command('get-prompt [server] <name> [args]')
    .description('Get an MCP prompt with optional JSON arguments')
    .option('--config <path>', 'Custom config file path (default: .mcp.json)')
    .option('--run <cmd>', 'Stdio run command (e.g., "npx -y @echo/server")')
    .option('--url <url>', 'HTTP server URL')
    .option('--server <json>', 'Full server config as JSON')
    .option('--json', 'Output as JSON')
    .action(async (server: string | undefined, name: string, args: string | undefined, options: Omit<GetPromptOptions, 'server' | 'name' | 'args'> & { server?: string; run?: string }) => {
      const opts: GetPromptOptions = {
        server,
        name,
        args: args || '{}',
        ...options,
        run: options.run,
        serverConfig: options.server, // Rename --server to serverConfig to avoid conflict
      };
      await getPromptCommand(opts);
    });

  program
    .command('search <query>')
    .description('Search for tools, prompts, and resources across MCP servers')
    .option('--config <path>', 'Custom config file path (default: .mcp.json)')
    .option('--servers <list>', 'Comma-separated server names to search')
    .option('--types <list>', 'Comma-separated types: tool,prompt,resource (default: all)')
    .option('--fields <list>', 'Comma-separated fields: name,description,schema,server (default: name,description,schema)')
    .option('--limit <number>', 'Maximum results to return (default: 20)', Number.parseInt)
    .option('--threshold <number>', 'Minimum relevance score 0-1 (default: 0)', Number.parseFloat)
    .option('--json', 'Output as JSON')
    .option('--attach', 'Connect to running servers (default: spawn servers)')
    .action(async (query: string, options) => {
      try {
        await searchCommand(query, options);
      } catch (error) {
        console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  // Add config command
  program.addCommand(createManifestCommand());

  program.parse(['node', 'cli', ...argv]);
}

// Entry point: run CLI when executed directly (not imported)
import { fileURLToPath } from 'url';

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url);
  if (process.argv[1] === modulePath || process.argv[1] === modulePath.replace(/\.ts$/, '.js')) {
    cli(process.argv.slice(2), 'mcp-z');
  }
}
