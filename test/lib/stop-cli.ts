import { type ChildProcess, execFile } from 'child_process';
import { promisify } from 'util';

const run = promisify(execFile);

/** Stop a CLI and its servers before waiting for their inherited pipes to close. */
export async function stopCli(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CLI process tree did not close within 10 seconds')), 10000);
    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  // Windows kill('SIGINT') terminates only the parent, leaving server pipes open.
  const stopped =
    process.platform === 'win32'
      ? run('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { timeout: 10000 }).catch(async (error: unknown) => {
          // The CLI may exit between the initial check and taskkill starting.
          // Accept that race only once all inherited pipes have actually closed.
          try {
            await closed;
          } catch {
            throw error;
          }
        })
      : Promise.resolve(child.kill('SIGINT'));
  await Promise.all([stopped, closed]);
}
