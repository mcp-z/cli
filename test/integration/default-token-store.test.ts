import assert from 'assert';
import { spawn } from 'child_process';
import * as fs from 'fs';
import { safeRmSync } from 'fs-remove-compat';
import * as path from 'path';
import startOAuthMetadataServer, { type OAuthMetadataServer, type OAuthMetadataServerOptions, SAVED_REFRESH_TOKEN } from '../lib/oauth-metadata-server.ts';

// The cli keeps sign-ins in the client's default store, <cwd>/.mcp-z/tokens.json, so each run
// gets its own scratch directory as the working directory.
const PACKAGE_ROOT = process.cwd();
const CLI = path.join(PACKAGE_ROOT, 'dist/cjs/cli.js');

type Entries = [string, { value: string }][];

const OTHER_KEY = 'dcr-tokens:https://other.example:https://other.example/mcp';

function writeStore(file: string, entries: Entries): void {
  fs.writeFileSync(file, JSON.stringify({ cache: entries, lastExpire: Date.now() }));
}

function readKeys(file: string): string[] {
  return (JSON.parse(fs.readFileSync(file, 'utf8')).cache as Entries).map(([key]) => key);
}

function storedToken(issuer: string): { value: string } {
  return { value: JSON.stringify({ value: { accessToken: 'saved-access', expiresAt: Date.now() + 3600_000, issuer } }) };
}

// A sign-in that has already expired and carries a refresh token, so the client refreshes it at the first request.
function refreshableToken(issuer: string): { value: string } {
  return { value: JSON.stringify({ value: { accessToken: 'expired-access', refreshToken: SAVED_REFRESH_TOKEN, clientId: 'saved-client', expiresAt: Date.now() - 1000, issuer } }) };
}

function runCli(cwd: string, args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LOG_LEVEL: 'info' } });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

describe('integration/default-token-store', () => {
  let scratch: string;
  let storeFile: string;
  let server: OAuthMetadataServer | undefined;
  let onRequest: Record<string, () => void>;

  beforeEach(() => {
    scratch = path.join(PACKAGE_ROOT, '.tmp', `default-token-store-${process.pid}-${Date.now()}`);
    fs.mkdirSync(path.join(scratch, '.mcp-z'), { recursive: true });
    storeFile = path.join(scratch, '.mcp-z', 'tokens.json');
    onRequest = {};
  });

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
    safeRmSync(scratch, { recursive: true, force: true });
  });

  async function callTool(seed: (issuer: string, storeKey: string) => void, serverOptions: Omit<OAuthMetadataServerOptions, 'onRequest'> = {}): Promise<{ code: number | null; output: string; storeKey: string }> {
    server = await startOAuthMetadataServer({ ...serverOptions, onRequest });
    const url = `${server.baseUrl}/mcp`;
    const storeKey = `dcr-tokens:${server.baseUrl}:${url}`;
    seed(server.baseUrl, storeKey);
    const config = path.join(scratch, '.mcp.json');
    fs.writeFileSync(config, JSON.stringify({ mcpServers: { secured: { type: 'http', url } } }));
    return { ...(await runCli(scratch, ['call-tool', 'secured', 'any-tool', '{}', '--config', config])), storeKey };
  }

  function addOtherProcessEntry(entry: { value: string }): void {
    const entries = JSON.parse(fs.readFileSync(storeFile, 'utf8')).cache as Entries;
    entries.push([OTHER_KEY, entry]);
    writeStore(storeFile, entries);
  }

  it('keeps entries another process wrote to the token file while the cli removes a sign-in the server refused to refresh', async () => {
    onRequest = { '/oauth/token': () => addOtherProcessEntry(storedToken('https://other.example')) };
    const { storeKey } = await callTool((issuer, key) => writeStore(storeFile, [[key, refreshableToken(issuer)]]), { tokenEndpoint: true, refuseRefresh: true });
    // The server refused the refresh, so the cli removed the saved sign-in after the other process wrote; the other process's entry stays.
    assert.deepStrictEqual(readKeys(storeFile), ['dcr-tokens:https://other.example:https://other.example/mcp']);
    assert.ok(!readKeys(storeFile).includes(storeKey));
  });

  it('keeps entries another process wrote to the token file while the cli refreshes a sign-in', async () => {
    const other = storedToken('https://other.example');
    onRequest = { '/oauth/token': () => addOtherProcessEntry(other) };
    const { storeKey } = await callTool((issuer, key) => writeStore(storeFile, [[key, refreshableToken(issuer)]]), { tokenEndpoint: true });
    const entries = JSON.parse(fs.readFileSync(storeFile, 'utf8')).cache as Entries;
    // The refreshed sign-in is saved under `tokens:`; the old `dcr-tokens:` entry stays beside it.
    assert.deepStrictEqual(readKeys(storeFile).sort(), [OTHER_KEY, storeKey, storeKey.replace('dcr-tokens:', 'tokens:')].sort());
    assert.deepStrictEqual(entries.find(([key]) => key === OTHER_KEY)?.[1], other);
  });

  it('reports a damaged token file by path and leaves it untouched', async () => {
    const { code, output } = await callTool(() => fs.writeFileSync(storeFile, '{"cache": [['));
    assert.notStrictEqual(code, 0);
    assert.ok(output.includes(storeFile), `expected the output to name ${storeFile}:\n${output}`);
    assert.strictEqual(fs.readFileSync(storeFile, 'utf8'), '{"cache": [[');
  });
});
