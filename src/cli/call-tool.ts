import { USAGE } from './index.ts';
import { parse, positionalsFor } from './shared.ts';
import type { Command } from './types.ts';

const callTool: Command = async (ctx) => {
  const usageLine = `usage: ${ctx.name} ${USAGE['call-tool']}`;
  const { values, positionals } = parse(ctx.rest, usageLine, { config: { type: 'string' }, run: { type: 'string' }, url: { type: 'string' }, server: { type: 'string' }, json: { type: 'boolean' } });
  const [server, tool, args] = positionalsFor(usageLine, 'call-tool', positionals, [
    { name: 'server', required: false },
    { name: 'tool', required: true },
    { name: 'args', required: true },
  ]);

  const { callToolCommand } = await import('../commands/call-tool.ts');
  // A --server value (inline JSON config) takes over the `server` field, matching the prior
  // commander-based CLI's object-spread order; serverConfig always carries it too.
  await callToolCommand({
    server: values.server !== undefined ? (values.server as string) : server,
    tool: tool as string,
    args: args as string,
    config: values.config as string | undefined,
    run: values.run as string | undefined,
    url: values.url as string | undefined,
    json: values.json as boolean | undefined,
    serverConfig: values.server as string | undefined,
  });
};

export default callTool;
