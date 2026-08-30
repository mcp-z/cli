import type { ParseArgsOptionsConfig } from 'node:util';
import { parseArgs } from 'node:util';

type Values = Record<string, string | boolean | undefined>;

export const ERROR_CODE = 23;

// Per-command parseArgs: strict (a foreign flag exits with ERROR_CODE), and every command gets --help for
// free. Mirrors sensemaking's src/cli/shared.ts `parse`.
export function parse(argv: string[], usage: string, options: ParseArgsOptionsConfig): { values: Values; positionals: string[] } {
  let values: Values;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: { ...options, help: { type: 'boolean', default: false, short: 'h' } },
      strict: true,
      allowPositionals: true,
    }));
  } catch (err) {
    console.error((err as Error).message);
    console.error(usage);
    process.exit(ERROR_CODE);
  }
  if (values.help) {
    console.log(usage);
    process.exit(0);
  }
  return { values, positionals };
}

// Fills declared positional params left-to-right from the provided tokens regardless of
// optional/required (matching the prior commander-based CLI's actual assignment order): a
// required param left unfilled, or excess tokens beyond the declared params, is a usage error.
export function positionalsFor(usage: string, command: string, positionals: string[], params: { name: string; required: boolean }[]): (string | undefined)[] {
  if (positionals.length > params.length) {
    console.error(`too many arguments for '${command}'. Expected ${params.length} but got ${positionals.length}: ${positionals.join(', ')}.`);
    console.error(usage);
    process.exit(ERROR_CODE);
  }
  const missing = params.slice(positionals.length).find((p) => p.required);
  if (missing) {
    console.error(`missing required argument '${missing.name}'`);
    console.error(usage);
    process.exit(ERROR_CODE);
  }
  return params.map((_, i) => positionals[i]);
}
