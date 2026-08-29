import type { Command } from './types.ts';

// Each command's usage line, minus the leading "usage: <name> " -- shared by cli.ts's
// top-level usage() and the command's own parse()/usageError output, so there is one copy of
// each line, not two that can drift.
export const USAGE = {
  up: 'up [--config <path>] [--stdio-only] [--http-only]',
  inspect: 'inspect [--config <path>] [--servers <list>] [--tools] [--resources] [--prompts] [--health] [--json] [--verbose] [--attach]',
  'call-tool': 'call-tool [server] <tool> <args> [--config <path>] [--run <cmd>] [--url <url>] [--server <json>] [--json]',
  'read-resource': 'read-resource [server] <uri> [--config <path>] [--run <cmd>] [--url <url>] [--server <json>] [--json]',
  'get-prompt': 'get-prompt [server] <name> [args] [--config <path>] [--run <cmd>] [--url <url>] [--server <json>] [--json]',
  search: 'search <query> [--config <path>] [--servers <list>] [--types <list>] [--fields <list>] [--limit <n>] [--threshold <n>] [--json] [--attach]',
  manifest: 'manifest <generate|validate> [options]',
} as const;

// Lazy registry: a command's imports load only when it runs, so a heavy dependency in one
// command (@mcp-z/client, ajv, @inquirer/*) never taxes the others (or --version/--help).
export const COMMANDS: Record<string, () => Promise<{ default: Command }>> = {
  up: () => import('./up.ts'),
  inspect: () => import('./inspect.ts'),
  'call-tool': () => import('./call-tool.ts'),
  'read-resource': () => import('./read-resource.ts'),
  'get-prompt': () => import('./get-prompt.ts'),
  search: () => import('./search.ts'),
  manifest: () => import('./manifest.ts'),
};

export type { Command, Ctx } from './types.ts';
