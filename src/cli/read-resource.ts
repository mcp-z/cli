import { USAGE } from './index.ts';
import { parse, positionalsFor } from './shared.ts';
import type { Command } from './types.ts';

const readResource: Command = async (ctx) => {
  const usageLine = `usage: ${ctx.name} ${USAGE['read-resource']}`;
  const { values, positionals } = parse(ctx.rest, usageLine, { config: { type: 'string' }, run: { type: 'string' }, url: { type: 'string' }, server: { type: 'string' }, json: { type: 'boolean' } });
  const [server, uri] = positionalsFor(usageLine, 'read-resource', positionals, [
    { name: 'server', required: false },
    { name: 'uri', required: true },
  ]);

  const { readResourceCommand } = await import('../commands/read-resource.ts');
  await readResourceCommand({
    server: values.server !== undefined ? (values.server as string) : server,
    uri: uri as string,
    config: values.config as string | undefined,
    run: values.run as string | undefined,
    url: values.url as string | undefined,
    json: values.json as boolean | undefined,
    serverConfig: values.server as string | undefined,
  });
};

export default readResource;
