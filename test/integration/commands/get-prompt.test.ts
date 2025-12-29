/**
 * Integration tests for get-prompt command
 *
 * Tests the full get-prompt command with real spawned servers.
 * Uses fixture servers (echo-server.ts) that don't require credentials.
 */

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getPromptCommand } from '../../../src/commands/get-prompt.ts';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('get-prompt command (integration)', () => {
  let tempDir: string;
  let testConfigPath: string;

  before(() => {
    tempDir = path.resolve('.tmp', `get-prompt-integration-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    // Create a test .mcp.json config with echo server
    const testConfig = {
      mcpServers: {
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
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore close errors
    }
  });

  describe('stdio mode', () => {
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
