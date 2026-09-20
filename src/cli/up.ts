import { USAGE } from './index.ts';
import { ERROR_CODE, parse } from './shared.ts';
import type { Command } from './types.ts';

const up: Command = async (ctx) => {
  const usageLine = `usage: ${ctx.name} ${USAGE.up}`;
  const { values } = parse(ctx.rest, usageLine, { config: { type: 'string' }, 'stdio-only': { type: 'boolean' }, 'http-only': { type: 'boolean' } });

  const { upCommand } = await import('../commands/up.ts');
  try {
    const clusterResult = await upCommand({ config: values.config as string | undefined, stdioOnly: values['stdio-only'] as boolean | undefined, httpOnly: values['http-only'] as boolean | undefined });

    // If httpOnly mode and no servers were spawned, exit immediately.
    if (values['http-only'] && clusterResult.servers.size === 0) {
      process.exitCode = 0;
      return;
    }

    let shutdownPromise: Promise<void> | undefined;
    let resolveShutdownFinished: (() => void) | undefined;
    const shutdownFinished = new Promise<void>((resolve) => {
      resolveShutdownFinished = resolve;
    });
    const handleSignal = (sig: 'SIGINT' | 'SIGTERM') => {
      void shutdown(sig);
    };
    const onSigInt = () => handleSignal('SIGINT');
    const onSigTerm = () => handleSignal('SIGTERM');

    function shutdown(sig: 'SIGINT' | 'SIGTERM'): Promise<void> {
      if (shutdownPromise) return shutdownPromise;

      shutdownPromise = (async () => {
        console.log('Shutting down (signal=', sig, ')');
        try {
          const result = await clusterResult.close(sig, { timeoutMs: 1000 });
          if (result.timedOut || result.killedCount > 0) {
            const status = result.killedCount > 0 ? `${result.killedCount} process(es) required emergency force termination` : 'the graceful shutdown timeout expired';
            console.error(`Shutdown was not fully graceful: ${status}.`);
            process.exitCode = ERROR_CODE;
          } else {
            process.exitCode = 0;
          }
        } catch (error) {
          console.error(`\n❌ Shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
          process.exitCode = ERROR_CODE;
        } finally {
          process.off('SIGINT', onSigInt);
          process.off('SIGTERM', onSigTerm);
          resolveShutdownFinished?.();
        }
      })();
      return shutdownPromise;
    }

    process.on('SIGINT', onSigInt);
    process.on('SIGTERM', onSigTerm);

    await shutdownFinished;
  } catch (error) {
    console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = ERROR_CODE;
  }
};

export default up;
