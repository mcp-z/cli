import { Command } from 'commander';
import { generateCommand } from './generate.ts';
import { validateCommand } from './validate.ts';

export function createManifestCommand(): Command {
  const manifest = new Command('manifest').description('Author and validate MCP server manifests (server.json)');

  manifest
    .command('generate')
    .description('Interactively generate a server manifest (server.json)')
    .option('--source', 'Use source code paths (node instead of npx)')
    .option('--json', 'Output to stdout instead of writing files')
    .option('--matrix', 'Generate all matrix combinations without prompts')
    .option('--output <dir>', 'Output directory (default: examples for --matrix, . otherwise)')
    .option('--quick', 'Skip optional env var prompts and use defaults')
    .action(async (options: unknown) => {
      try {
        await generateCommand(options as { source?: boolean; json?: boolean; matrix?: boolean; output?: string; quick?: boolean });
      } catch (error) {
        console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  manifest
    .command('validate <file>')
    .description('Validate a server manifest against the MCP schema')
    .action(async (filePath: string) => {
      try {
        await validateCommand(filePath);
      } catch (error) {
        console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  return manifest;
}
