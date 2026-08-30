import { USAGE } from './index.ts';
import { ERROR_CODE, parse } from './shared.ts';
import type { Command } from './types.ts';

const inspect: Command = async (ctx) => {
  const usageLine = `usage: ${ctx.name} ${USAGE.inspect}`;
  const { values } = parse(ctx.rest, usageLine, {
    config: { type: 'string' },
    servers: { type: 'string' },
    tools: { type: 'boolean' },
    resources: { type: 'boolean' },
    prompts: { type: 'boolean' },
    health: { type: 'boolean' },
    json: { type: 'boolean' },
    verbose: { type: 'boolean' },
    attach: { type: 'boolean' },
  });

  const { inspectCommand } = await import('../commands/inspect.ts');
  try {
    await inspectCommand({
      config: values.config as string | undefined,
      servers: values.servers as string | undefined,
      tools: values.tools as boolean | undefined,
      resources: values.resources as boolean | undefined,
      prompts: values.prompts as boolean | undefined,
      health: values.health as boolean | undefined,
      json: values.json as boolean | undefined,
      verbose: values.verbose as boolean | undefined,
      attach: values.attach as boolean | undefined,
    });
  } catch (error) {
    console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ERROR_CODE);
  }
};

export default inspect;
