import { ERROR_CODE, parse, positionalsFor } from './shared.ts';
import type { Command } from './types.ts';

const SUB_USAGE = {
  generate: 'manifest generate [--source] [--json] [--matrix] [--output <dir>] [--quick]',
  validate: 'manifest validate <file>',
};

function usage(name: string): string {
  return [`usage: ${name} manifest <command> [options]`, '', 'Author and validate MCP server manifests (server.json)', '', 'Commands:', `  ${name} ${SUB_USAGE.generate}`, `  ${name} ${SUB_USAGE.validate}`].join('\n');
}

// Dispatches manifest's own sub-subcommands (generate, validate). Each lazily imports its
// implementation so `mcp-z manifest --help` never pays for @inquirer/* or ajv.
const manifest: Command = async (ctx) => {
  const first = ctx.rest[0];

  if (!first || first.startsWith('-')) {
    if (first === '--help' || first === '-h') {
      console.log(usage(ctx.name));
      return;
    }
    ctx.usageError(usage(ctx.name));
  }

  const rest = ctx.rest.slice(1);

  if (first === 'generate') {
    const usageLine = `usage: ${ctx.name} ${SUB_USAGE.generate}`;
    const { values } = parse(rest, usageLine, {
      source: { type: 'boolean' },
      json: { type: 'boolean' },
      matrix: { type: 'boolean' },
      output: { type: 'string' },
      quick: { type: 'boolean' },
    });
    try {
      const { generateCommand } = await import('../commands/manifest/generate.ts');
      await generateCommand({ source: values.source as boolean | undefined, json: values.json as boolean | undefined, matrix: values.matrix as boolean | undefined, output: values.output as string | undefined, quick: values.quick as boolean | undefined });
    } catch (error) {
      console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
      process.exit(ERROR_CODE);
    }
    return;
  }

  if (first === 'validate') {
    const usageLine = `usage: ${ctx.name} ${SUB_USAGE.validate}`;
    const { positionals } = parse(rest, usageLine, {});
    const [file] = positionalsFor(usageLine, 'validate', positionals, [{ name: 'file', required: true }]);
    try {
      const { validateCommand } = await import('../commands/manifest/validate.ts');
      await validateCommand(file as string);
    } catch (error) {
      console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
      process.exit(ERROR_CODE);
    }
    return;
  }

  console.error(`Unknown command '${first}'`);
  ctx.usageError(usage(ctx.name));
};

export default manifest;
