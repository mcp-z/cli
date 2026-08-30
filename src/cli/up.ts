import { USAGE } from './index.ts';
import { ERROR_CODE, parse } from './shared.ts';
import type { Command } from './types.ts';

const up: Command = async (ctx) => {
  const usageLine = `usage: ${ctx.name} ${USAGE.up}`;
  const { values } = parse(ctx.rest, usageLine, { config: { type: 'string' }, 'stdio-only': { type: 'boolean' }, 'http-only': { type: 'boolean' } });

  const { upCommand } = await import('../commands/up.ts');
  try {
    const clusterResult = await upCommand({ config: values.config as string | undefined, stdioOnly: values['stdio-only'] as boolean | undefined, httpOnly: values['http-only'] as boolean | undefined });

    // If httpOnly mode and no servers were spawned, exit immediately
    if (values['http-only'] && clusterResult.servers.size === 0) process.exit(0);

    const shutdown = async (sig: string) => {
      console.log('Shutting down (signal=', sig, ')');
      if (clusterResult && typeof clusterResult.close === 'function') {
        try {
          await clusterResult.close(sig === 'SIGTERM' ? 'SIGTERM' : 'SIGINT', { timeoutMs: 1000 });
        } catch (_) {
          /* ignore */
        }
      }
      process.exit(0);
    };

    // Signal handlers trigger async shutdown then exit
    process.on('SIGINT', () => {
      shutdown('SIGINT').catch(() => process.exit(ERROR_CODE));
    });
    process.on('SIGTERM', () => {
      shutdown('SIGTERM').catch(() => process.exit(ERROR_CODE));
    });

    // Keep process alive - wait for signal
    await new Promise(() => {});
  } catch (error) {
    console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ERROR_CODE);
  }
};

export default up;
