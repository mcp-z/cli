import assert from 'assert';
import { execFile } from 'child_process';
import * as fs from 'fs';
import { safeRmSync } from 'fs-remove-compat';
import * as path from 'path';
import { promisify } from 'util';
import { type RecordingServer, startRecordingServer } from '../lib/servers/recording-http.ts';

const run = promisify(execFile);
const ROOT = process.cwd();
const CLI = path.join(ROOT, 'dist', 'cjs', 'cli.js');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { name: string; version: string };

describe('integration/client-info', () => {
  let server: RecordingServer;
  let tempDir: string;
  let configPath: string;

  before(async () => {
    server = await startRecordingServer();
    tempDir = path.join(ROOT, '.tmp', `client-info-${process.pid}-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    configPath = path.join(tempDir, '.mcp.json');
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { rec: { type: 'http', url: server.url } } }));
  });

  after(async () => {
    try {
      await server.close();
    } finally {
      safeRmSync(tempDir, { recursive: true, force: true });
    }
  });

  const commands: Record<string, string[]> = {
    'call-tool': ['call-tool', 'rec', 'echo', '{}'],
    'read-resource': ['read-resource', 'rec', 'rec://item'],
    'get-prompt': ['get-prompt', 'rec', 'greet'],
    inspect: ['inspect', '--tools'],
    search: ['search', 'echo'],
  };

  for (const [name, args] of Object.entries(commands)) {
    it(`${name} identifies the cli to the server`, async () => {
      const before = server.clientInfos.length;
      await run(process.execPath, [CLI, ...args, '--config', configPath]);
      const seen = server.clientInfos.slice(before);
      assert.ok(seen.length > 0, 'server received no initialize request');
      for (const info of seen) assert.deepStrictEqual(info, { name: pkg.name, version: pkg.version });
    });
  }
});

describe('integration/client-info without a readable package.json', () => {
  let server: RecordingServer;
  let tempDir: string;

  before(async () => {
    server = await startRecordingServer();
    tempDir = path.join(ROOT, '.tmp', `client-info-broken-${process.pid}-${Date.now()}`);
    fs.mkdirSync(path.join(tempDir, 'dist'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'dist', 'cjs'), path.join(tempDir, 'dist', 'cjs'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{');
    fs.writeFileSync(path.join(tempDir, '.mcp.json'), JSON.stringify({ mcpServers: { rec: { type: 'http', url: server.url } } }));
  });

  after(async () => {
    try {
      await server.close();
    } finally {
      safeRmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails naming the file and sends no client info', async () => {
    const result = await run(process.execPath, [path.join(tempDir, 'dist', 'cjs', 'cli.js'), 'call-tool', 'rec', 'echo', '{}', '--config', path.join(tempDir, '.mcp.json')]).then(
      () => ({ code: 0, output: '' }),
      (error: { code: number; stdout: string; stderr: string }) => ({ code: error.code, output: error.stdout + error.stderr })
    );
    assert.notStrictEqual(result.code, 0);
    assert.ok(result.output.includes(path.join(tempDir, 'package.json')), `expected the output to name the package.json:\n${result.output}`);
    assert.deepStrictEqual(server.clientInfos, []);
  });
});
