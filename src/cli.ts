// Parsing and dispatch only. Commands live in src/cli/, one file each, lazy-loaded —
// nothing dependency-heavy may be imported at the top of this file (@mcp-z/client, ajv,
// @inquirer/* must never load for --version/--help or a command that doesn't need them).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS, USAGE } from './cli/index.ts';
import type { Ctx } from './cli/types.ts';

// __dirname (CJS) or its ESM equivalent, then two fixed hops up to the package root. NOT
// `import.meta.resolve('@mcp-z/cli/package.json')` -- Node's self-reference lookup throws
// ERR_MODULE_NOT_FOUND from a file this deep; a location-relative path is stable across both
// build targets (dist/cjs/cli.js and dist/esm/cli.js are both two hops below the root).
const __dirname = path.dirname(typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url));

function packageVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function usage(name: string): string {
  const lines = Object.values(USAGE).map((u) => `  ${name} ${u}`);
  return [`Usage: ${name} <command> [options]`, '', 'mcp-z helper CLI', '', 'Commands:', ...lines, '', 'Options:', '  --version, -v    Show version number', '  --help, -h       Show this help message'].join('\n');
}

// Thrown errors -> exit 1 with the message verbatim; usage errors exit 2.
export default async function cli(argv: string[], name: string): Promise<void> {
  if (argv[0] === '--version' || argv[0] === '-v') {
    console.log(packageVersion());
    return;
  }
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    if (argv.length === 0) {
      console.error(usage(name));
      process.exit(2);
    }
    console.log(usage(name));
    return;
  }

  const ctx: Ctx = {
    name,
    rest: argv.slice(1),
    usageError(message) {
      console.error(message);
      process.exit(2);
    },
  };

  const load = COMMANDS[argv[0]];
  if (!load) {
    console.error(`Unknown command '${argv[0]}'`);
    console.error(usage(name));
    process.exit(2);
  }

  try {
    await (await load()).default(ctx);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

// Entry point: run CLI when executed directly (not imported)
if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url);
  if (process.argv[1] === modulePath || process.argv[1] === modulePath.replace(/\.ts$/, '.js')) {
    cli(process.argv.slice(2), 'mcp-z');
  }
}
