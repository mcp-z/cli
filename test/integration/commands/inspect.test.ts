/**
 * Integration tests for inspect command
 *
 * Tests the full inspect command with real spawned servers.
 * These tests use fixture servers (minimal-stdio.ts) that don't require credentials.
 */

import { createServerRegistry, type ServerRegistry } from '@mcp-z/client';
import assert from 'assert';
import * as fs from 'fs';
import getPort from 'get-port';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { inspectCommand } from '../../../src/commands/inspect.ts';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('inspect command (integration)', () => {
  let tempDir: string;
  let testConfigPath: string;

  before(() => {
    tempDir = path.resolve('.tmp', `inspect-integration-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    // Create a test .mcp.json config with minimal echo server
    const testConfig = {
      mcpServers: {
        'test-server': {
          command: 'node',
          args: [path.join(__dirname, '../../lib/servers/minimal-stdio.mjs')],
          env: {
            CLUSTER_ID: 'test-cluster-inspect',
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

  describe('spawn mode', () => {
    it('should spawn servers and show summary', async () => {
      // Capture console output
      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        output.push(args.join(' '));
      };

      try {
        await inspectCommand({ config: testConfigPath });

        // Restore console.log
        console.log = originalLog;

        // Verify output contains server info
        const fullOutput = output.join('\n');
        assert.ok(fullOutput.includes('test-server'), 'should show server name');
        assert.ok(fullOutput.includes('tools') || fullOutput.includes('ready'), 'should show server status');
      } catch (error: unknown) {
        // Restore console.log even on error
        console.log = originalLog;
        throw error;
      }
    });

    it('should show tools with --tools flag', async () => {
      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        output.push(args.join(' '));
      };

      try {
        await inspectCommand({ tools: true, config: testConfigPath });
        console.log = originalLog;

        const fullOutput = output.join('\n');
        assert.ok(fullOutput.includes('test-server'), 'should show server name');
        assert.ok(fullOutput.includes('tools'), 'should mention tools');
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
        await inspectCommand({ json: true, config: testConfigPath });
        console.log = originalLog;

        const fullOutput = output.join('\n');

        // Should be valid JSON
        const parsed = JSON.parse(fullOutput);
        assert.ok(parsed.servers, 'should have servers object');
        assert.ok(parsed.servers['test-server'], 'should have test-server entry');
      } catch (error: unknown) {
        console.log = originalLog;
        throw error;
      }
    });

    it('should filter servers with --servers flag', async () => {
      // Create config with multiple servers
      const multiServerConfig = {
        mcpServers: {
          'server-1': {
            command: 'node',
            args: [path.join(__dirname, '../../lib/servers/minimal-stdio.mjs')],
            env: { CLUSTER_ID: 'test-cluster-inspect' },
          },
          'server-2': {
            command: 'node',
            args: [path.join(__dirname, '../../lib/servers/minimal-stdio.mjs')],
            env: { CLUSTER_ID: 'test-cluster-inspect' },
          },
        },
      };

      const multiConfigPath = path.join(tempDir, 'multi.json');
      fs.writeFileSync(multiConfigPath, JSON.stringify(multiServerConfig, null, 2));

      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        output.push(args.join(' '));
      };

      try {
        await inspectCommand({ config: multiConfigPath, servers: 'server-1' });
        console.log = originalLog;

        const fullOutput = output.join('\n');
        assert.ok(fullOutput.includes('server-1'), 'should show server-1');
        // Note: We can't assert that server-2 is NOT shown because the summary might include counts
      } catch (error: unknown) {
        console.log = originalLog;
        throw error;
      }
    });

    it('should show health status with --health flag', async () => {
      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        output.push(args.join(' '));
      };

      try {
        await inspectCommand({ health: true, config: testConfigPath });
        console.log = originalLog;

        const fullOutput = output.join('\n');
        assert.ok(fullOutput.includes('test-server'), 'should show server name');
        assert.ok(fullOutput.includes('ready') || fullOutput.includes('✓'), 'should show ready status');
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
          await inspectCommand({ config: nonExistentConfig });
        },
        /Config file not found/,
        'should throw error for missing config'
      );
    });

    it('should throw error for unknown server', async () => {
      await assert.rejects(
        async () => {
          await inspectCommand({ servers: 'unknown-server', config: testConfigPath });
        },
        /Server\(s\) not found in config: unknown-server/,
        'should throw error for unknown server'
      );
    });
  });

  describe('custom config path', () => {
    it('should load config from --config path', async () => {
      const customDir = path.join(tempDir, 'custom');
      fs.mkdirSync(customDir, { recursive: true });

      const customConfig = {
        mcpServers: {
          'custom-server': {
            command: 'node',
            args: [path.join(__dirname, '../../lib/servers/minimal-stdio.mjs')],
            env: { CLUSTER_ID: 'test-cluster-custom' },
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
        await inspectCommand({ config: customPath });
        console.log = originalLog;

        const fullOutput = output.join('\n');
        assert.ok(fullOutput.includes('custom-server'), 'should show custom-server from custom config');
      } catch (error: unknown) {
        console.log = originalLog;
        throw error;
      }
    });
  });

  describe('partial MCP implementations', () => {
    it('should handle servers that only implement tools (not resources/prompts)', async () => {
      // Create config with partial-implementation server
      // This mimics third-party servers like Todoist that only implement tools/list
      const partialConfig = {
        mcpServers: {
          'partial-server': {
            command: 'node',
            args: [path.join(__dirname, '../../lib/servers/partial-stdio.mjs')],
            env: { CLUSTER_ID: 'test-cluster-partial' },
          },
        },
      };

      const partialConfigPath = path.join(tempDir, 'partial.json');
      fs.writeFileSync(partialConfigPath, JSON.stringify(partialConfig, null, 2));

      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        output.push(args.join(' '));
      };

      try {
        await inspectCommand({ config: partialConfigPath });
        console.log = originalLog;

        const fullOutput = output.join('\n');

        // Should show server as ready (not failed)
        assert.ok(fullOutput.includes('partial-server'), 'should show server name');
        assert.ok(!fullOutput.includes('failed'), 'should NOT mark server as failed');
        assert.ok(!fullOutput.includes('Method not found'), 'should NOT show method not found error');

        // Should show tools that ARE implemented
        assert.ok(fullOutput.includes('tools'), 'should show tools capability');
        assert.ok(fullOutput.includes('partial-tool'), 'should show the tool from partial implementation');
      } catch (error: unknown) {
        console.log = originalLog;
        throw error;
      }
    });
  });

  describe('verbose mode', () => {
    it('should show detailed parameter information with --verbose flag', async () => {
      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        output.push(args.join(' '));
      };

      try {
        await inspectCommand({ verbose: true, config: testConfigPath });
        console.log = originalLog;

        const fullOutput = output.join('\n');

        // Should show parameter details
        assert.ok(fullOutput.includes('Parameters:') || fullOutput.includes('Required') || fullOutput.includes('Optional'), 'should show parameter section headers');

        // Should show types
        assert.ok(fullOutput.includes('(string)') || fullOutput.includes('(object)') || fullOutput.includes('(boolean)'), 'should show parameter types');
      } catch (error: unknown) {
        console.log = originalLog;
        throw error;
      }
    });

    it('should combine --tools and --verbose flags', async () => {
      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        output.push(args.join(' '));
      };

      try {
        await inspectCommand({ tools: true, verbose: true, config: testConfigPath });
        console.log = originalLog;

        const fullOutput = output.join('\n');

        // Should show tools
        assert.ok(fullOutput.includes('tools') || fullOutput.includes('📦'), 'should show tools section');

        // Should show verbose parameter details
        assert.ok(fullOutput.includes('Parameters:') || fullOutput.includes('Required') || fullOutput.includes('Optional'), 'should show parameter details');
      } catch (error: unknown) {
        console.log = originalLog;
        throw error;
      }
    });

    it('should show enum values in verbose mode', async () => {
      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        output.push(args.join(' '));
      };

      try {
        await inspectCommand({ verbose: true, config: testConfigPath });
        console.log = originalLog;

        const fullOutput = output.join('\n');

        // If the test server has enum parameters, they should be shown
        // This is a general check that enum handling works
        if (fullOutput.includes('enum')) {
          assert.ok(fullOutput.includes('Options:'), 'should show enum options');
        }
      } catch (error: unknown) {
        console.log = originalLog;
        throw error;
      }
    });

    it('should show prompts with verbose details', async () => {
      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        output.push(args.join(' '));
      };

      try {
        await inspectCommand({ prompts: true, verbose: true, config: testConfigPath });
        console.log = originalLog;

        const fullOutput = output.join('\n');

        // Should show prompts section
        assert.ok(fullOutput.includes('prompts') || fullOutput.includes('📦'), 'should show prompts section');

        // If prompts have arguments, verbose should show them
        if (fullOutput.includes('Arguments:')) {
          assert.ok(fullOutput.includes('(string)') || fullOutput.includes('(object)'), 'should show argument types');
        }
      } catch (error: unknown) {
        console.log = originalLog;
        throw error;
      }
    });
  });

  describe('attach mode', () => {
    it('should connect to already-running HTTP server with --attach flag', async () => {
      // Simulate two-process workflow:
      // Process A: Spawn server with http-only mode
      // Process B: Connect to running server with --attach

      const port = await getPort();
      const url = `http://localhost:${port}/mcp`;

      const httpConfig = {
        mcpServers: {
          'echo-http': {
            type: 'http' as const,
            url,
            start: {
              command: 'node',
              args: [path.join(__dirname, '../../lib/servers/echo-http.mjs'), '--port', String(port)],
            },
          },
        },
      };

      const httpConfigPath = path.join(tempDir, 'http-attach.json');
      fs.writeFileSync(httpConfigPath, JSON.stringify(httpConfig, null, 2));

      // Process A: Spawn the server (http-only mode)
      const projectRoot = path.resolve(__dirname, '../../..');
      const serversConfig = httpConfig.mcpServers;
      const registry: ServerRegistry = createServerRegistry(serversConfig, { cwd: projectRoot, dialects: ['start'] });

      try {
        // Wait for server to be ready by trying to connect
        // The registry.connect() handles waiting for HTTP readiness
        const client = await registry.connect('echo-http');
        await client.close();

        // Process B: Connect to already-running server
        const output: string[] = [];
        const originalLog = console.log;
        console.log = (...args: unknown[]) => {
          output.push(args.join(' '));
        };

        try {
          await inspectCommand({ config: httpConfigPath, attach: true });
          console.log = originalLog;

          const fullOutput = output.join('\n');
          assert.ok(fullOutput.includes('echo-http'), 'should show server name');
          assert.ok(fullOutput.includes('tools') || fullOutput.includes('echo'), 'should show server capabilities');
          assert.ok(!fullOutput.includes('failed'), 'should not show failure');
        } catch (error: unknown) {
          console.log = originalLog;
          throw error;
        }
      } finally {
        await registry.close();
      }
    });

    it('should fail gracefully when --attach used with no running servers', async () => {
      const httpConfig = {
        mcpServers: {
          'http-missing': {
            type: 'http' as const,
            url: 'http://localhost:19999/mcp', // Port unlikely to be in use
          },
        },
      };

      const httpConfigPath = path.join(tempDir, 'http-missing.json');
      fs.writeFileSync(httpConfigPath, JSON.stringify(httpConfig, null, 2));

      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        output.push(args.join(' '));
      };

      try {
        await inspectCommand({ config: httpConfigPath, attach: true });
        console.log = originalLog;

        const fullOutput = output.join('\n');
        assert.ok(fullOutput.includes('http-missing'), 'should show server name');
        assert.ok(fullOutput.includes('failed') || fullOutput.includes('ECONNREFUSED'), 'should show failure status');
      } catch (error: unknown) {
        console.log = originalLog;
        throw error;
      }
    });
  });
});
