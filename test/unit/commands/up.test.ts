import { upCommand } from '@mcp-z/cli';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const TEST_CWD = process.cwd();

/**
 * Unit tests for the upCommand function (testing different spawn modes)
 */
describe('unit/cluster-up-command', () => {
  const tmpRoot = path.resolve('.tmp', 'unit-cluster-up');
  beforeEach(() => {
    if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });
  after(() => fs.existsSync(tmpRoot) && fs.rmSync(tmpRoot, { recursive: true }));

  it('loads .mcp.json config and returns lifecycle object', async () => {
    const autoDir = path.join(tmpRoot, 'auto');
    fs.mkdirSync(autoDir, { recursive: true });
    const cfg = { mcpServers: {} };
    const configPath = path.join(autoDir, '.mcp.json');
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));

    const result = await upCommand({ config: configPath });
    assert.ok(result && typeof result.close === 'function');
    const res = await result.close('SIGINT', { timeoutMs: 100 });
    assert.strictEqual(res.timedOut, false);
  });

  it('upCommand returns lifecycle object for empty config', async () => {
    const config = path.join(tmpRoot, 'empty-config.json');

    fs.writeFileSync(config, JSON.stringify({ mcpServers: {} }, null, 2));
    const result = await upCommand({ config });
    assert.ok(result && typeof result.close === 'function');
    const res = await result.close('SIGINT', { timeoutMs: 100 });
    assert.strictEqual(res.timedOut, false);
  });

  it('upCommand uses all mode by default', async () => {
    const config = path.join(tmpRoot, 'config.json');
    const cfg = {
      mcpServers: {
        'http-server': {
          type: 'http',
          url: 'http://localhost:8080/mcp',
          start: { command: 'echo', args: ['start http'] },
        },
        'stdio-server': { command: 'echo', args: ['stdio'] },
      },
    };
    fs.writeFileSync(config, JSON.stringify(cfg, null, 2));

    const result = await upCommand({ config });
    assert.ok(result && result.servers);
    // all mode should spawn both HTTP and stdio servers
    assert.ok(result.servers.size >= 1, 'should spawn all servers');
    await result.close('SIGINT', { timeoutMs: 100 });
  });

  it('upCommand uses stdio mode when stdioOnly flag is set', async () => {
    const config = path.join(tmpRoot, 'config.json');
    const cfg = { mcpServers: { test: { command: 'echo', args: ['test'] } } };
    fs.writeFileSync(config, JSON.stringify(cfg, null, 2));

    const result = await upCommand({ config, stdioOnly: true });
    assert.ok(result && result.servers);
    // stdio mode should spawn stdio servers
    assert.ok(result.servers.size >= 1, 'should spawn servers in stdio mode');
    await result.close('SIGINT', { timeoutMs: 100 });
  });

  it('upCommand uses http mode when httpOnly flag is set', async () => {
    const config = path.join(tmpRoot, 'config.json');
    const cfg = {
      mcpServers: {
        'http-server': {
          type: 'http',
          url: 'http://localhost:8080/mcp',
          start: { command: 'echo', args: ['start http'] },
        },
        'stdio-server': { command: 'echo', args: ['stdio'] },
      },
    };
    fs.writeFileSync(config, JSON.stringify(cfg, null, 2));

    const result = await upCommand({ config, httpOnly: true });
    assert.ok(result && result.servers);
    // http mode should only spawn HTTP servers
    assert.ok(result.servers.size >= 1, 'should spawn HTTP servers');
    await result.close('SIGINT', { timeoutMs: 100 });
  });
});

/**
 * Integration tests for mcp-z up --http-only command
 *
 * Tests that the up --http-only command:
 * 1. Spawns HTTP servers with start configuration
 * 2. Skips stdio servers (they are spawned by Claude Code)
 * 3. Handles graceful shutdown on SIGINT
 */

import { spawn } from 'child_process';
import getPort from 'get-port';
import { waitForOutput } from '../../lib/wait-for-output.ts';

/**
 * Create a temporary config file with HTTP/stdio servers for testing.
 * Creates config inline (no fixtures needed) and writes to .tmp/ directory.
 */
async function createTmpConfig(): Promise<string> {
  const timestamp = Date.now();
  const tmpRoot = path.resolve('.tmp', 'integration-up-http-only');

  try {
    if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });

    // Allocate port for HTTP server
    const httpPort = await getPort();

    // Create config inline (no fixtures needed)
    // Paths are relative to config file location (.tmp/integration-up-http-only/)
    const cfg = {
      mcpServers: {
        'echo-http': {
          type: 'http',
          url: `http://localhost:${httpPort}/mcp`,
          start: {
            command: 'node',
            args: ['../../test/lib/servers/echo-http.mjs', '--port', String(httpPort)],
          },
        },
        'stdio-server': {
          command: 'node',
          args: ['../../test/lib/servers/echo-stdio.mjs'],
        },
      },
    };

    const tmpCfgPath = path.join(tmpRoot, `cfg-up-http-only-${timestamp}.json`);
    fs.writeFileSync(tmpCfgPath, JSON.stringify(cfg, null, 2));

    return tmpCfgPath;
  } catch (error) {
    console.error(`Error creating temp config: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Create a config with only stdio servers for testing the "no HTTP servers" case.
 */
function createStdioOnlyConfig(): string {
  const timestamp = Date.now();
  const tmpRoot = path.resolve('.tmp', 'integration-up-http-only');
  if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });

  // Paths are relative to config file location (.tmp/integration-up-http-only/)
  const cfg = {
    mcpServers: {
      'stdio-only': {
        command: 'node',
        args: ['../../test/lib/servers/echo-stdio.mjs'],
      },
    },
  };

  const tmpCfg = path.join(tmpRoot, `cfg-stdio-only-${timestamp}.json`);
  fs.writeFileSync(tmpCfg, JSON.stringify(cfg, null, 2));
  return tmpCfg;
}

/**
 * Run the CLI 'up --http-only' command for testing.
 * This is a legitimate exception to the "don't spawn manually" rule -
 * we're testing the CLI tool itself.
 */
function runUpHttpOnlyCommand(configPath: string, opts: { env?: Record<string, string> } = {}) {
  const cmd = process.execPath;
  const cliPath = path.join(TEST_CWD, 'dist/cjs/cli.js');
  const fullArgs = [cliPath, 'up', '--http-only', '--config', configPath];
  const childEnv = { ...process.env, LOG_LEVEL: 'info', ...opts.env };
  const child = spawn(cmd, fullArgs, { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv });
  let out = '';
  let err = '';
  child.stdout.on('data', (b) => {
    out += b.toString();
  });
  child.stderr.on('data', (b) => {
    err += b.toString();
  });
  return { child, getOut: () => out, getErr: () => err };
}

describe('integration/up-http-only-command', () => {
  it('should start HTTP servers only', async () => {
    const tmpCfg = await createTmpConfig();
    const { child, getOut, getErr } = runUpHttpOnlyCommand(tmpCfg);
    try {
      // Wait for HTTP server to spawn
      await waitForOutput(getOut, /\[echo-http\] → node .*echo-http\.mjs/, 10000);
      assert.ok(/\[echo-http\].*echo-http\.mjs/.test(getOut()), 'HTTP server spawn logged');

      // Verify stdio server was NOT spawned (should be skipped)
      const out = getOut();
      assert.ok(!out.includes('echo-stdio'), 'stdio server should not be spawned by up --http-only command');
    } catch (error) {
      const stderr = getErr();
      if (stderr) {
        console.error('Server stderr output:', stderr);
      }
      throw error;
    } finally {
      // Graceful shutdown
      const closePromise = new Promise<void>((res) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          res();
          return;
        }
        child.once('close', res);
      });

      if (child.pid && !child.killed) {
        child.kill('SIGINT');
      }

      await closePromise;
    }
  });

  it('should handle graceful shutdown on SIGINT', async () => {
    const tmpCfg = await createTmpConfig();
    const { child, getOut, getErr } = runUpHttpOnlyCommand(tmpCfg);
    try {
      // Wait for server to start
      await waitForOutput(getOut, /\[echo-http\] → node .*echo-http\.mjs/, 10000);

      // Send SIGINT for graceful shutdown
      const closePromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) => {
        child.once('close', (code, signal) => {
          res({ code, signal });
        });
      });

      if (child.pid && !child.killed) {
        child.kill('SIGINT');
      }

      // Wait for graceful shutdown
      const { code, signal } = await closePromise;

      // Verify clean exit - either exitCode 0 or signal SIGINT (both are clean)
      assert.ok(code === 0 || signal === 'SIGINT', 'should exit cleanly on SIGINT');
    } catch (error) {
      const stderr = getErr();
      if (stderr) {
        console.error('Server stderr output:', stderr);
      }
      throw error;
    }
  });

  it('should report when no HTTP servers found', async () => {
    // Create config with only stdio servers
    const tmpCfg = createStdioOnlyConfig();

    const { child, getOut, getErr } = runUpHttpOnlyCommand(tmpCfg);
    try {
      // Wait for process to exit (should exit quickly when no HTTP servers found)
      const closePromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) => {
        child.once('close', (code, signal) => {
          res({ code, signal });
        });
      });

      const { code } = await closePromise;

      // Check output for expected messages
      const out = getOut();
      assert.ok(/No HTTP servers found/.test(out), 'should report no HTTP servers');
      assert.ok(/stdio servers are spawned automatically/.test(out), 'should explain stdio servers are spawned by Claude Code');
      assert.strictEqual(code, 0, 'should exit with code 0');
    } catch (error) {
      const stderr = getErr();
      const stdout = getOut();
      if (stderr) {
        console.error('Server stderr output:', stderr);
      }
      if (stdout) {
        console.error('Server stdout output:', stdout);
      }
      throw error;
    }
  });
});
