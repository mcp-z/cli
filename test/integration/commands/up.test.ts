import assert from 'assert';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { waitForOutput } from '../../lib/wait-for-output.ts';

// Capture working directory at module load time to avoid ENOENT errors
// when process.cwd() is called after other tests have changed directories
const TEST_CWD = process.cwd();

/**
 * Create a temporary config file for testing the CLI tool.
 * Creates config inline (no fixtures needed) and writes to .tmp/ directory.
 */
async function createTmpConfig(): Promise<string> {
  const timestamp = Date.now();
  const tmpRoot = path.join(TEST_CWD, '.tmp');

  try {
    fs.mkdirSync(tmpRoot, { recursive: true });

    // Create config inline (no fixtures needed)
    // Paths are relative to config file location (.tmp/)
    const cfg = {
      mcpServers: {
        'my-local': {
          command: 'node',
          args: ['test/lib/servers/my-local.mjs'],
        },
      },
    };

    const tmpCfgPath = path.join(tmpRoot, `cfg-up-${timestamp}.json`);
    fs.writeFileSync(tmpCfgPath, JSON.stringify(cfg, null, 2));

    return tmpCfgPath;
  } catch (error) {
    console.error(`Error creating temp config: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

describe('integration/cluster-up', () => {
  it('integration: cluster starts servers', async () => {
    const tmpCfg = await createTmpConfig();

    // Spawn the CLI directly to test the 'up' command
    const child = spawn(process.execPath, [path.join(TEST_CWD, 'dist/cjs/cli.js'), 'up', '--config', tmpCfg], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LOG_LEVEL: 'info' },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (b) => {
      out += b.toString();
    });
    child.stderr.on('data', (b) => {
      err += b.toString();
    });
    const getOut = () => out;
    const getErr = () => err;

    try {
      // Wait for the cluster to spawn the node process for my-local server
      await waitForOutput(getOut, /\[my-local\] → node .*my-local\.mjs/, 10000);
      assert.ok(/\[my-local\].*my-local\.mjs/.test(getOut()), 'server spawn logged');
    } catch (error) {
      // Log stderr output for debugging on failure
      const stderr = getErr();
      if (stderr) {
        console.error('Server stderr output:', stderr);
      }
      throw error;
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
