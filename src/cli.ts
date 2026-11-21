// Parsing and dispatch only. Commands live in src/cli/, one file each, lazy-loaded —
// nothing dependency-heavy may be imported at the top of this file (@mcp-z/client, ajv,
// @inquirer/* must never load for --version/--help or a command that doesn't need them).
import { fileURLToPath } from 'node:url';
import { COMMANDS, USAGE } from './cli/index.ts';
import { ERROR_CODE } from './cli/shared.ts';
import type { Ctx } from './cli/types.ts';
import { packageVersion } from './lib/client-info.ts';

function usage(name: string): string {
  const lines = Object.values(USAGE).map((u) => `  ${name} ${u}`);
  return [`Usage: ${name} <command> [options]`, '', 'mcp-z helper CLI', '', 'Commands:', ...lines, '', 'Options:', '  --version, -v    Show version number', '  --help, -h       Show this help message'].join('\n');
}

// All failures exit ERROR_CODE: usage errors with the usage text, thrown errors with the message verbatim.
export default async function cli(argv: string[], name: string): Promise<void> {
  if (argv[0] === '--version' || argv[0] === '-v') {
    console.log(packageVersion());
    return;
  }
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    if (argv.length === 0) {
      console.error(usage(name));
      process.exit(ERROR_CODE);
    }
    console.log(usage(name));
    return;
  }

  const ctx: Ctx = {
    name,
    rest: argv.slice(1),
    usageError(message) {
      console.error(message);
      process.exit(ERROR_CODE);
    },
  };

  const load = COMMANDS[argv[0]];
  if (!load) {
    console.error(`Unknown command '${argv[0]}'`);
    console.error(usage(name));
    process.exit(ERROR_CODE);
  }

  try {
    await (await load()).default(ctx);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(ERROR_CODE);
  }
}

// Entry point: run CLI when executed directly (not imported)
if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url);
  if (process.argv[1] === modulePath || process.argv[1] === modulePath.replace(/\.ts$/, '.js')) {
    cli(process.argv.slice(2), 'mcp-z');
  }
}
