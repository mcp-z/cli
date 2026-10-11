/**
 * Integration tests for read-resource command
 *
 * Tests the full read-resource command with real spawned servers.
 * Uses fixture servers (echo-server.ts) that don't require credentials.
 */

import { readResourceCommand } from '@mcp-z/cli';
import assert from 'assert';
import * as fs from 'fs';
import { safeRmSync } from 'fs-remove-compat';
import * as path from 'path';
import * as url from 'url';

const __dirname = path.dirname(typeof __filename !== 'undefined' ? __filename : url.fileURLToPath(import.meta.url));

describe('read-resource command (integration)', () => {
  const richResource = {
    _meta: { 'fixture/result': 'resource' },
    fixtureExtension: { preserved: true },
    contents: [
      { uri: 'fixture://first', mimeType: 'text/plain', text: 'First text entry', _meta: { 'fixture/entry': 'first' } },
      { uri: 'fixture://second', mimeType: 'text/plain', text: 'Second text entry' },
      { uri: 'fixture://binary', mimeType: 'application/octet-stream', blob: 'AAEC' },
      { uri: 'fixture://unknown', blob: 'c2Vjb25k' },
    ],
  };
  let tempDir: string;
  let testConfigPath: string;

  before(() => {
    tempDir = path.resolve('.tmp', `read-resource-integration-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const richServerPath = path.join(tempDir, 'resource-output.mjs');
    fs.writeFileSync(
      richServerPath,
      `import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const server = new Server({ name: 'resource-output', version: '1.0.0' }, { capabilities: { resources: {} } });
server.setRequestHandler(ReadResourceRequestSchema, async () => (${JSON.stringify(richResource)}));
await server.connect(new StdioServerTransport());
`
    );

    // Create a test .mcp.json config with echo server
    const testConfig = {
      mcpServers: {
        rich: { command: 'node', args: [richServerPath] },
        echo: {
          command: 'node',
          args: [path.join(__dirname, '../../lib/servers/echo-stdio.mjs')],
          env: {
            NODE_ENV: 'test',
          },
        },
      },
    };

    testConfigPath = path.join(tempDir, '.mcp.json');
    fs.writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));
  });

  after(() => {
    try {
      safeRmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore close errors
    }
  });

  describe('stdio mode', () => {
    it('preserves every text and binary entry in text output', async () => {
      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => output.push(args.join(' '));

      try {
        await readResourceCommand({ server: 'rich', uri: 'fixture://multiple', config: testConfigPath });
      } finally {
        console.log = originalLog;
      }

      assert.deepStrictEqual(output.slice(output.indexOf('Content:')), ['Content:', 'First text entry', 'Content:', 'Second text entry', 'Blob content (application/octet-stream): 4 bytes', 'Blob content (unknown type): 8 bytes']);
    });

    it('preserves all entries and metadata with JSON formatting', async () => {
      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => output.push(args.join(' '));

      try {
        await readResourceCommand({ server: 'rich', uri: 'fixture://multiple', json: true, config: testConfigPath });
      } finally {
        console.log = originalLog;
      }

      assert.strictEqual(output.length, 1);
      const parsed = JSON.parse(output[0]);
      assert.deepStrictEqual(parsed, richResource);
      assert.strictEqual(output[0], JSON.stringify(parsed, null, 2));
    });

    it('should read resource from stdio server and display result', async () => {
      // Capture console output
      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        output.push(args.join(' '));
      };

      try {
        await readResourceCommand({
          server: 'echo',
          uri: 'echo://test-message',
          config: testConfigPath,
        });

        console.log = originalLog;

        const fullOutput = output.join('\n');
        assert.ok(fullOutput.includes('test-message'), 'should include the message in URI');
      } catch (error: unknown) {
        console.log = originalLog;
        throw error;
      }
    });

    it('should output JSON with --json flag', async () => {
      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        output.push(args.join(' '));
      };

      try {
        await readResourceCommand({
          server: 'echo',
          uri: 'echo://json-test',
          json: true,
          config: testConfigPath,
        });

        console.log = originalLog;

        const fullOutput = output.join('\n');

        // Should be valid JSON
        const parsed = JSON.parse(fullOutput);
        assert.ok(parsed, 'should have result object');
        assert.ok(parsed.contents, 'should have contents array');
      } catch (error: unknown) {
        console.log = originalLog;
        throw error;
      }
    });

    it('should load config from --config path', async () => {
      const customDir = path.join(tempDir, 'custom');
      fs.mkdirSync(customDir, { recursive: true });

      const customConfig = {
        mcpServers: {
          'custom-echo': {
            command: 'node',
            args: [path.join(__dirname, '../../lib/servers/echo-stdio.mjs')],
            env: { NODE_ENV: 'test' },
          },
        },
      };

      const customPath = path.join(customDir, 'custom.json');
      fs.writeFileSync(customPath, JSON.stringify(customConfig, null, 2));

      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        output.push(args.join(' '));
      };

      try {
        await readResourceCommand({
          server: 'custom-echo',
          uri: 'echo://custom-test',
          config: customPath,
        });

        console.log = originalLog;

        const fullOutput = output.join('\n');
        assert.ok(fullOutput.includes('custom-test'), 'should use custom config');
      } catch (error: unknown) {
        console.log = originalLog;
        throw error;
      }
    });
  });

  describe('error handling', () => {
    it('should throw error for missing config file', async () => {
      const emptyDir = path.join(tempDir, 'empty');
      fs.mkdirSync(emptyDir, { recursive: true });
      const nonExistentConfig = path.join(emptyDir, '.mcp.json');

      await assert.rejects(
        async () => {
          await readResourceCommand({
            server: 'echo',
            uri: 'echo://test',
            config: nonExistentConfig,
          });
        },
        /Config file not found/,
        'should throw error for missing config'
      );
    });

    it('should throw error for unknown server', async () => {
      await assert.rejects(
        async () => {
          await readResourceCommand({
            server: 'unknown-server',
            uri: 'echo://test',
            config: testConfigPath,
          });
        },
        /Server 'unknown-server' not found in config/,
        'should throw error for unknown server'
      );
    });
  });
});
