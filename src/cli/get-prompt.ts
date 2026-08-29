import { USAGE } from './index.ts';
import { parse, positionalsFor } from './shared.ts';
import type { Command } from './types.ts';

const getPrompt: Command = async (ctx) => {
  const usageLine = `usage: ${ctx.name} ${USAGE['get-prompt']}`;
  const { values, positionals } = parse(ctx.rest, usageLine, { config: { type: 'string' }, run: { type: 'string' }, url: { type: 'string' }, server: { type: 'string' }, json: { type: 'boolean' } });
  const [server, name, args] = positionalsFor(usageLine, 'get-prompt', positionals, [
    { name: 'server', required: false },
    { name: 'name', required: true },
    { name: 'args', required: false },
  ]);

  const { getPromptCommand } = await import('../commands/get-prompt.ts');
  await getPromptCommand({
    server: values.server !== undefined ? (values.server as string) : server,
    name: name as string,
    args: args || '{}',
    config: values.config as string | undefined,
    run: values.run as string | undefined,
    url: values.url as string | undefined,
    json: values.json as boolean | undefined,
    serverConfig: values.server as string | undefined,
  });
};

export default getPrompt;
