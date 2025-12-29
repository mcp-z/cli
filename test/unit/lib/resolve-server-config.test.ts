import { isHttpServer, isStdioServer, resolveServerConfig } from '@mcp-z/cli';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

describe('unit/lib/resolve-server-config', () => {
  const tmpDir = path.join('.tmp', `test-resolve-config-${Date.now()}`);

  before(async () => {
    await fs.promises.mkdir(tmpDir, { recursive: true });
  });

  after(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  describe('inline config - --run', () => {
    it('should parse simple run string', () => {
      const result = resolveServerConfig({
        run: 'npx -y @echo/server',
      });

      assert.strictEqual(result.serverName, 'inline');
      assert.ok(isStdioServer(result.serverConfig));
      assert.strictEqual(result.serverConfig.command, 'npx');
      assert.deepStrictEqual(result.serverConfig.args, ['-y', '@echo/server']);
      assert.strictEqual(result.configDir, process.cwd());
    });

    it('should use provided server name', () => {
      const result = resolveServerConfig({
        server: 'my-echo',
        run: 'npx @echo/server',
      });

      assert.strictEqual(result.serverName, 'my-echo');
    });

    it('should parse run string with multiple args', () => {
      const result = resolveServerConfig({
        run: 'node server.js --port 3000 --debug',
      });

      assert.ok(isStdioServer(result.serverConfig));
      assert.strictEqual(result.serverConfig.command, 'node');
      assert.deepStrictEqual(result.serverConfig.args, ['server.js', '--port', '3000', '--debug']);
    });

    it('should throw for empty run string', () => {
      assert.throws(() => resolveServerConfig({ run: '   ' }), /Run string cannot be empty/);
    });
  });

  describe('inline config - --url', () => {
    it('should create HTTP config from URL', () => {
      const result = resolveServerConfig({
        url: 'https://api.example.com/mcp',
      });

      assert.strictEqual(result.serverName, 'inline');
      assert.strictEqual(result.serverConfig.type, 'http');
      if (result.serverConfig.type === 'http') {
        assert.strictEqual(result.serverConfig.url, 'https://api.example.com/mcp');
      }
    });

    it('should use provided server name for HTTP', () => {
      const result = resolveServerConfig({
        server: 'my-api',
        url: 'https://api.example.com/mcp',
      });

      assert.strictEqual(result.serverName, 'my-api');
    });
  });

  describe('inline config - --server (JSON)', () => {
    it('should parse stdio config JSON', () => {
      const result = resolveServerConfig({
        serverConfig: '{"command":"npx","args":["-y","@echo/server"],"env":{"DEBUG":"true"}}',
      });

      assert.ok(isStdioServer(result.serverConfig));
      assert.strictEqual(result.serverConfig.command, 'npx');
      assert.deepStrictEqual(result.serverConfig.args, ['-y', '@echo/server']);
      assert.deepStrictEqual(result.serverConfig.env, { DEBUG: 'true' });
    });

    it('should parse HTTP config JSON', () => {
      const result = resolveServerConfig({
        serverConfig: '{"url":"https://api.example.com/mcp","headers":{"X-API-Key":"secret"}}',
      });

      assert.ok(isHttpServer(result.serverConfig));
      assert.strictEqual(result.serverConfig.url, 'https://api.example.com/mcp');
      assert.deepStrictEqual(result.serverConfig.headers, { 'X-API-Key': 'secret' });
    });

    it('should throw for invalid JSON', () => {
      assert.throws(() => resolveServerConfig({ serverConfig: 'not-json' }), /Failed to parse server config JSON/);
    });

    it('should throw for non-object JSON', () => {
      assert.throws(() => resolveServerConfig({ serverConfig: '"string"' }), /Server config must be a JSON object/);
    });

    it('should throw for missing command/url', () => {
      assert.throws(() => resolveServerConfig({ serverConfig: '{"env":{"DEBUG":"true"}}' }), /must have either "command".*or "url"/);
    });

    it('should validate against MCP schema (invalid args type)', () => {
      // args must be an array, not a string
      assert.throws(() => resolveServerConfig({ serverConfig: '{"command":"node","args":"not-an-array"}' }), /Invalid server config/);
    });

    it('should validate against MCP schema (invalid env type)', () => {
      // env values must be strings
      assert.throws(() => resolveServerConfig({ serverConfig: '{"command":"node","env":{"DEBUG":123}}' }), /Invalid server config/);
    });

    it('should accept valid MCP schema with all fields', () => {
      const result = resolveServerConfig({
        serverConfig: '{"command":"node","args":["server.js"],"env":{"DEBUG":"true"},"cwd":"/tmp"}',
      });

      assert.ok(isStdioServer(result.serverConfig));
      assert.strictEqual(result.serverConfig.command, 'node');
      assert.deepStrictEqual(result.serverConfig.args, ['server.js']);
    });
  });

  describe('mutual exclusivity', () => {
    it('should throw when multiple inline options provided', () => {
      assert.throws(
        () =>
          resolveServerConfig({
            run: 'npx @echo/server',
            url: 'https://api.example.com/mcp',
          }),
        /Cannot use multiple inline config options/
      );
    });

    it('should throw when --run and --server provided', () => {
      assert.throws(
        () =>
          resolveServerConfig({
            run: 'npx @echo/server',
            serverConfig: '{"command":"node","args":["server.js"]}',
          }),
        /Cannot use multiple inline config options/
      );
    });

    it('should throw when inline config and --config provided', () => {
      assert.throws(
        () =>
          resolveServerConfig({
            run: 'npx @echo/server',
            config: '.mcp.json',
          }),
        /Cannot use --config with inline config options/
      );
    });
  });

  describe('config file resolution', () => {
    it('should load server from config file', async () => {
      // Create a temp config file
      const configPath = path.join(tmpDir, '.mcp.json');
      const config = {
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['test-server.js'],
          },
        },
      };
      await fs.promises.writeFile(configPath, JSON.stringify(config));

      const result = resolveServerConfig({
        server: 'test-server',
        config: configPath,
      });

      assert.strictEqual(result.serverName, 'test-server');
      assert.ok(isStdioServer(result.serverConfig));
      assert.strictEqual(result.serverConfig.command, 'node');
      assert.deepStrictEqual(result.serverConfig.args, ['test-server.js']);
    });

    it('should throw when server not in config', async () => {
      const configPath = path.join(tmpDir, '.mcp-empty.json');
      await fs.promises.writeFile(configPath, JSON.stringify({ mcpServers: {} }));

      assert.throws(
        () =>
          resolveServerConfig({
            server: 'nonexistent',
            config: configPath,
          }),
        /Server 'nonexistent' not found in config/
      );
    });

    it('should throw when server name missing for config file', () => {
      assert.throws(() => resolveServerConfig({}), /Server name is required/);
    });
  });

  describe('fullConfig for HTTP auth', () => {
    it('should include fullConfig for inline config', () => {
      const result = resolveServerConfig({
        server: 'my-server',
        run: 'npx @echo/server',
      });

      assert.ok(result.fullConfig);
      assert.ok(result.fullConfig['my-server']);
    });

    it('should include fullConfig for file-based config', async () => {
      const configPath = path.join(tmpDir, '.mcp-full.json');
      const config = {
        mcpServers: {
          'server-a': { command: 'node', args: ['a.js'] },
          'server-b': { command: 'node', args: ['b.js'] },
        },
      };
      await fs.promises.writeFile(configPath, JSON.stringify(config));

      const result = resolveServerConfig({
        server: 'server-a',
        config: configPath,
      });

      assert.ok(result.fullConfig['server-a']);
      assert.ok(result.fullConfig['server-b']);
    });
  });
});
