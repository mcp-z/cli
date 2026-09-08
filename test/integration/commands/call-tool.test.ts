/**
 * Integration tests for call-tool command
 *
 * Tests the full call-tool command with real spawned servers.
 * Uses fixture servers (echo-server.ts) that don't require credentials.
 */

import { callToolCommand } from '@mcp-z/cli';
import assert from 'assert';
import * as fs from 'fs';
import { safeRmSync } from 'fs-remove-compat';
import * as path from 'path';
import * as url from 'url';

const __dirname = path.dirname(typeof __filename !== 'undefined' ? __filename : url.fileURLToPath(import.meta.url));

describe('call-tool command (integration)', () => {
  let tempDir: string;
  let testConfigPath: string;
  let modernConfigPath: string;

  before(() => {
    tempDir = path.resolve('.tmp', `call-tool-integration-${Date.now()}`);
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

    // Config pointing at the 2026-07-28-era fixture (offers the modern revision via server/discover)
    const modernConfig = {
      mcpServers: {
        modern: {
          command: 'node',
          args: [path.join(__dirname, '../../lib/servers/modern-stdio.mjs')],
        },
      },
    };

    modernConfigPath = path.join(tempDir, 'modern.json');
    fs.writeFileSync(modernConfigPath, JSON.stringify(modernConfig, null, 2));
  });

  after(() => {
    try {
      safeRmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore close errors
    }
  });

  describe('stdio mode', () => {
    it('should call tool on stdio server and display result', async () => {
      // Capture console output
      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        output.push(args.join(' '));
      };

      try {
        await callToolCommand({
          server: 'echo',
          tool: 'echo',
          args: JSON.stringify({ message: 'test-message' }),
          config: testConfigPath,
        });

        console.log = originalLog;

        const fullOutput = output.join('\n');
        assert.ok(fullOutput.includes('test-message'), 'should echo the message');
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
        await callToolCommand({
          server: 'echo',
          tool: 'echo',
          args: JSON.stringify({ message: 'json-test' }),
          json: true,
          config: testConfigPath,
        });

        console.log = originalLog;

        const fullOutput = output.join('\n');

        // Should be valid JSON
        const parsed = JSON.parse(fullOutput);
        assert.ok(parsed, 'should have result object');
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
        await callToolCommand({
          server: 'custom-echo',
          tool: 'echo',
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

  describe('--protocol', () => {
    it('should connect with --protocol legacy', async () => {
      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        output.push(args.join(' '));
      };

      try {
        await callToolCommand({
          server: 'echo',
          tool: 'echo',
          args: JSON.stringify({ message: 'legacy-message' }),
          protocol: 'legacy',
          config: testConfigPath,
        });
      } finally {
        console.log = originalLog;
      }

      assert.ok(output.join('\n').includes('legacy-message'), 'should echo the message with --protocol legacy');
    });

    it('should probe and fall back with --protocol auto on a 2025 server', async () => {
      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        output.push(args.join(' '));
      };

      try {
        await callToolCommand({
          server: 'echo',
          tool: 'echo',
          args: JSON.stringify({ message: 'auto-legacy-message' }),
          protocol: 'auto',
          config: testConfigPath,
        });
      } finally {
        console.log = originalLog;
      }

      assert.ok(output.join('\n').includes('auto-legacy-message'), 'should fall back to the 2025 sequence and echo the message');
    });

    it('should negotiate the modern revision with --protocol 2026-07-28', async () => {
      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        output.push(args.join(' '));
      };

      try {
        await callToolCommand({
          server: 'modern',
          tool: 'echo',
          args: JSON.stringify({ message: 'modern-message' }),
          protocol: '2026-07-28',
          config: modernConfigPath,
        });
      } finally {
        console.log = originalLog;
      }

      assert.ok(output.join('\n').includes('modern-message'), 'should connect pinned to 2026-07-28 and echo the message');
    });

    it('should fail a pinned 2026-07-28 connect against a 2025-only server with a friendly error', async () => {
      await assert.rejects(
        async () => {
          await callToolCommand({
            server: 'echo',
            tool: 'echo',
            args: JSON.stringify({ message: 'test' }),
            protocol: '2026-07-28',
            config: testConfigPath,
          });
        },
        (err: Error) => {
          assert.match(err.message, /does not speak protocol revision 2026-07-28/);
          assert.match(err.message, /--protocol auto/);
          return true;
        },
        'should suggest --protocol auto instead of showing the SDK wire error'
      );
    });

    it('should reject an invalid --protocol value, naming the accepted ones', async () => {
      await assert.rejects(
        async () => {
          await callToolCommand({
            server: 'echo',
            tool: 'echo',
            args: JSON.stringify({ message: 'test' }),
            protocol: 'bogus',
            config: testConfigPath,
          });
        },
        (err: Error) => {
          assert.match(err.message, /Invalid --protocol value 'bogus'/);
          assert.match(err.message, /Accepted values: legacy, auto, 2026-07-28/);
          return true;
        },
        'should fail immediately on an invalid value'
      );
    });
  });

  describe('error handling', () => {
    it('should throw error for missing config file', async () => {
      const emptyDir = path.join(tempDir, 'empty');
      fs.mkdirSync(emptyDir, { recursive: true });
      const nonExistentConfig = path.join(emptyDir, '.mcp.json');

      await assert.rejects(
        async () => {
          await callToolCommand({
            server: 'echo',
            tool: 'echo',
            args: JSON.stringify({ message: 'test' }),
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
          await callToolCommand({
            server: 'unknown-server',
            tool: 'echo',
            args: JSON.stringify({ message: 'test' }),
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
          await callToolCommand({
            server: 'echo',
            tool: 'echo',
            args: '{invalid json}',
            config: testConfigPath,
          });
        },
        /Failed to parse tool arguments as JSON/,
        'should throw error for invalid JSON'
      );
    });

    it('should throw error for unknown tool', async () => {
      await assert.rejects(
        async () => {
          await callToolCommand({
            server: 'echo',
            tool: 'nonexistent-tool',
            args: JSON.stringify({ message: 'test' }),
            config: testConfigPath,
          });
        },
        /Tool.*not found|Unknown tool/i,
        'should throw error for unknown tool'
      );
    });
  });
});
