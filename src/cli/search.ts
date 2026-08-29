import { USAGE } from './index.ts';
import { parse, positionalsFor } from './shared.ts';
import type { Command } from './types.ts';

const search: Command = async (ctx) => {
  const usageLine = `usage: ${ctx.name} ${USAGE.search}`;
  const { values, positionals } = parse(ctx.rest, usageLine, {
    config: { type: 'string' },
    servers: { type: 'string' },
    types: { type: 'string' },
    fields: { type: 'string' },
    limit: { type: 'string' },
    threshold: { type: 'string' },
    json: { type: 'boolean' },
    attach: { type: 'boolean' },
  });
  const [query] = positionalsFor(usageLine, 'search', positionals, [{ name: 'query', required: true }]);

  const { searchCommand } = await import('../commands/search.ts');
  try {
    await searchCommand(query as string, {
      config: values.config as string | undefined,
      servers: values.servers as string | undefined,
      types: values.types as string | undefined,
      fields: values.fields as string | undefined,
      limit: values.limit !== undefined ? Number.parseInt(values.limit as string, 10) : undefined,
      threshold: values.threshold !== undefined ? Number.parseFloat(values.threshold as string) : undefined,
      json: values.json as boolean | undefined,
      attach: values.attach as boolean | undefined,
    });
  } catch (error) {
    console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
};

export default search;
