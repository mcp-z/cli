import { upCommand } from '@mcp-z/cli';
import assert from 'assert';
import * as fs from 'fs';
import { safeRmSync } from 'fs-remove-compat';
import * as path from 'path';
import { stopCli } from '../../lib/stop-cli.ts';

const TEST_CWD = process.cwd();

/**
 * Unit tests for the upCommand function (testing different spawn modes)
 */
describe('unit/cluster-up-command', () => {
  const tmpRoot = path.resolve('.tmp', 'unit-cluster-up');
  beforeEach(() => {
    if (fs.existsSync(tmpRoot)) safeRmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });
  after(() => fs.existsSync(tmpRoot) && safeRmSync(tmpRoot, { recursive: true, force: true }));

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
    if (fs.existsSync(tmpRoot)) safeRmSync(tmpRoot, { recursive: true, force: true });
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
            stop: {
              command: 'node',
              args: ['../../test/lib/servers/request-http-stop.mjs', `http://127.0.0.1:${httpPort}/__mcpz/shutdown`],
            },
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
  if (fs.existsSync(tmpRoot)) safeRmSync(tmpRoot, { recursive: true, force: true });
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

function getShutdownUrl(configPath: string): string {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
    mcpServers: { 'echo-http': { start: { stop: { args: string[] } } } };
  };
  const url = config.mcpServers['echo-http']?.start.stop.args[1];
  if (!url) throw new Error('HTTP test config is missing its application shutdown URL');
  return url;
}

function waitForClose(child: ReturnType<typeof runUpHttpOnlyCommand>['child'], timeoutMs: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.once('close', (code, signal) => resolve({ code, signal }))),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`CLI process did not close within ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function requestHttpShutdown(url: string): Promise<void> {
  const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(2000) });
  await response.arrayBuffer();
  assert.strictEqual(response.status, 202, 'owned HTTP fixture should accept cooperative shutdown');
}

async function waitForHttpReady(shutdownUrl: string, timeoutMs = 10000): Promise<void> {
  const readyUrl = new URL('/mcp', shutdownUrl);
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    const controller = new AbortController();
    const requestTimer = setTimeout(() => controller.abort(), 500);
    try {
      const response = await fetch(readyUrl, { signal: controller.signal });
      await response.arrayBuffer();
      if (response.status === 405) return;
      lastError = new Error(`HTTP server readiness endpoint returned ${response.status}`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(requestTimer);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`HTTP fixture did not become ready within ${timeoutMs}ms: ${detail}`);
}

describe('integration/up-http-only-command', () => {
  it('should start HTTP servers only', async () => {
    const tmpCfg = await createTmpConfig();
    const { child, getOut, getErr } = runUpHttpOnlyCommand(tmpCfg);
    let closed = false;
    try {
      // Wait for HTTP server to spawn
      await waitForOutput(getOut, /\[echo-http\] → node .*echo-http\.mjs/, 10000);
      await waitForHttpReady(getShutdownUrl(tmpCfg));
      assert.ok(/\[echo-http\].*echo-http\.mjs/.test(getOut()), 'HTTP server spawn logged');

      // Verify stdio server was NOT spawned (should be skipped)
      const out = getOut();
      assert.ok(!out.includes('echo-stdio'), 'stdio server should not be spawned by up --http-only command');

      await requestHttpShutdown(getShutdownUrl(tmpCfg));
      const result = await waitForClose(child, 5000);
      closed = true;
      assert.strictEqual(result.code, 0, 'CLI should exit after its owned HTTP process closes');
    } catch (error) {
      const stderr = getErr();
      if (stderr) {
        console.error('Server stderr output:', stderr);
      }
      throw error;
    } finally {
      if (!closed) await stopCli(child);
    }
  });

  it('should shut down owned HTTP servers without force on the available platform path', async () => {
    const tmpCfg = await createTmpConfig();
    const { child, getOut, getErr } = runUpHttpOnlyCommand(tmpCfg);
    let closed = false;
    try {
      // Wait for server to start
      await waitForOutput(getOut, /\[echo-http\] → node .*echo-http\.mjs/, 10000);
      await waitForHttpReady(getShutdownUrl(tmpCfg));

      const closePromise = waitForClose(child, 5000);
      if (process.platform === 'win32') {
        await requestHttpShutdown(getShutdownUrl(tmpCfg));
      } else if (child.pid && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGINT');
      }

      const { code, signal } = await closePromise;
      closed = true;
      assert.strictEqual(code, 0, `CLI should exit cleanly after cooperative shutdown (signal=${signal ?? 'none'})`);
    } catch (error) {
      const stderr = getErr();
      if (stderr) {
        console.error('Server stderr output:', stderr);
      }
      throw error;
    } finally {
      if (!closed) await stopCli(child);
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
