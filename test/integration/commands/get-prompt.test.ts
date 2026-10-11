/**
 * Integration tests for get-prompt command
 *
 * Tests the full get-prompt command with real spawned servers.
 * Uses fixture servers (echo-server.ts) that don't require credentials.
 */

import { getPromptCommand } from '@mcp-z/cli';
import assert from 'assert';
import * as fs from 'fs';
import { safeRmSync } from 'fs-remove-compat';
import * as path from 'path';
import * as url from 'url';

const __dirname = path.dirname(typeof __filename !== 'undefined' ? __filename : url.fileURLToPath(import.meta.url));

describe('get-prompt command (integration)', () => {
  const richPrompt = {
    description: 'Rich prompt description',
    _meta: { 'fixture/result': 'prompt' },
    fixtureExtension: { preserved: true },
    messages: [
      { role: 'user', content: { type: 'text', text: 'First user text' } },
      { role: 'assistant', content: { type: 'text', text: 'Second assistant text' } },
      { role: 'assistant', content: { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png', annotations: { audience: ['user'], priority: 0.7 } } },
      { role: 'user', content: { type: 'resource', resource: { uri: 'fixture://embedded', mimeType: 'text/plain', text: 'Embedded resource text', _meta: { 'fixture/entry': 'embedded' } } } },
      { role: 'assistant', content: { type: 'resource_link', uri: 'fixture://linked', name: 'Linked resource', mimeType: 'application/octet-stream' } },
    ],
  };
  let tempDir: string;
  let testConfigPath: string;

  before(() => {
    tempDir = path.resolve('.tmp', `get-prompt-integration-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const richServerPath = path.join(tempDir, 'prompt-output.mjs');
    fs.writeFileSync(
      richServerPath,
      `import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GetPromptRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const server = new Server({ name: 'prompt-output', version: '1.0.0' }, { capabilities: { prompts: {} } });
server.setRequestHandler(GetPromptRequestSchema, async () => (${JSON.stringify(richPrompt)}));
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
    it('preserves description, roles and rich content in text output', async () => {
      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => output.push(args.join(' '));

      try {
        await getPromptCommand({ server: 'rich', name: 'rich', args: '{}', config: testConfigPath });
      } finally {
        console.log = originalLog;
      }

      assert.deepStrictEqual(output.slice(output.indexOf('Description: Rich prompt description\n')), [
        'Description: Rich prompt description\n',
        'Messages:',
        '  [user]:',
        '    First user text',
        '  [assistant]:',
        '    Second assistant text',
        '  [assistant]:',
        '    [Image: image/png]',
        '  [user]:',
        '    [Resource: fixture://embedded]',
        '  [assistant]:',
      ]);
    });

    it('preserves the complete prompt result and formatting in JSON output', async () => {
      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => output.push(args.join(' '));

      try {
        await getPromptCommand({ server: 'rich', name: 'rich', args: '{}', json: true, config: testConfigPath });
      } finally {
        console.log = originalLog;
      }

      assert.strictEqual(output.length, 1);
      const parsed = JSON.parse(output[0]);
      assert.deepStrictEqual(parsed, richPrompt);
      assert.strictEqual(output[0], JSON.stringify(parsed, null, 2));
    });

    it('should get prompt from stdio server and display result', async () => {
      // Capture console output
      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        output.push(args.join(' '));
      };

      try {
        await getPromptCommand({
          server: 'echo',
          name: 'echo',
          args: JSON.stringify({ message: 'test-message' }),
          config: testConfigPath,
        });

        console.log = originalLog;

        const fullOutput = output.join('\n');
        assert.ok(fullOutput.includes('test-message'), 'should include the message');
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
        await getPromptCommand({
          server: 'echo',
          name: 'echo',
          args: JSON.stringify({ message: 'json-test' }),
          json: true,
          config: testConfigPath,
        });

        console.log = originalLog;

        const fullOutput = output.join('\n');

        // Should be valid JSON
        const parsed = JSON.parse(fullOutput);
        assert.ok(parsed, 'should have result object');
        assert.ok(parsed.messages, 'should have messages array');
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
        await getPromptCommand({
          server: 'custom-echo',
          name: 'echo',
          args: JSON.stringify({ message: 'custom-test' }),
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
          await getPromptCommand({
            server: 'echo',
            name: 'echo',
            args: '{}',
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
          await getPromptCommand({
            server: 'unknown-server',
            name: 'echo',
            args: '{}',
            config: testConfigPath,
          });
        },
        /Server 'unknown-server' not found in config/,
        'should throw error for unknown server'
      );
    });

    it('should throw error for invalid JSON args', async () => {
      await assert.rejects(
        async () => {
          await getPromptCommand({
            server: 'echo',
            name: 'echo',
            args: '{invalid json}',
            config: testConfigPath,
          });
        },
        /Failed to parse prompt arguments as JSON/,
        'should throw error for invalid JSON'
      );
    });
  });
});
