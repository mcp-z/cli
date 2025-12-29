import assert from 'assert';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { waitForOutput } from '../lib/wait-for-output.ts';

// Capture working directory at module load time to avoid ENOENT errors
// when process.cwd() is called after other tests have changed directories
const TEST_CWD = process.cwd();

/**
 * Create a temporary config file for testing cwd resolution.
 * Uses relative paths to verify they resolve correctly from the config directory.
 */
async function createTmpConfig(): Promise<string> {
  const tmpRoot = path.join(TEST_CWD, '.tmp', 'integration-cwd');
  fs.mkdirSync(tmpRoot, { recursive: true });

  // Create config inline with relative path to test cwd resolution
  const cfg = {
    mcpServers: {
      'my-local': {
        command: 'node',
        args: ['./test/lib/servers/my-local.mjs'],
      },
    },
  };

  // Write tmp config
  const tmpCfgPath = path.join(tmpRoot, `cfg-cwd-${Date.now()}.json`);
  fs.writeFileSync(tmpCfgPath, JSON.stringify(cfg, null, 2));
  return tmpCfgPath;
}

describe('integration/cwd-resolution', () => {
  it('spawn logs relative path when args include ./ and cwd is config dir', async () => {
    const tmpCfg = await createTmpConfig();

    // Spawn the CLI directly to test cwd resolution
    const child = spawn(process.execPath, [path.join(TEST_CWD, 'src/cli.ts'), 'up', '--config', tmpCfg], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LOG_LEVEL: 'info' },
    });
    let out = '';
    child.stdout.on('data', (b) => {
      out += b.toString();
    });
    child.stderr.on('data', (b) => {
      out += b.toString();
    });
    const getOut = () => out;

    try {
      // Expect the spawn log to include a relative path to test/lib/servers/my-local.mjs
      await waitForOutput(getOut, /\[my-local\] → node .*my-local\.mjs/, 10000);
      assert.match(getOut(), /\[my-local\].*my-local\.mjs/);
    } finally {
      // Graceful shutdown - attach listener BEFORE killing to avoid race condition
      const closePromise = new Promise<void>((res) => {
        // If process already exited, resolve immediately
        if (child.exitCode !== null || child.signalCode !== null) {
          res();
          return;
        }
        child.once('close', res);
      });

      if (child.pid && !child.killed) {
        child.kill('SIGINT');
      }

      // Wait for 'close' event (stdio streams fully closed)
      await closePromise;
    }
  });
});
