import { validateCommand } from '@mcp-z/cli';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

describe('manifest validate command', () => {
  const tmpDir = path.join('.tmp', 'config-validate-tests');

  before(() => {
    // Create temp directory for test files
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    // Clean up temp files
    try {
      const files = fs.readdirSync(tmpDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tmpDir, file));
      }
      fs.rmdirSync(tmpDir);
    } catch (_error) {
      // Ignore close errors
    }
  });

  describe('file existence', () => {
    it('should fail when config file does not exist', async () => {
      const nonExistentFile = path.join(tmpDir, 'non-existent.json');

      await assert.rejects(
        async () => {
          await validateCommand(nonExistentFile);
        },
        {
          code: 1,
        },
        'Should exit with code 1 for non-existent file'
      );
    });
  });

  describe('JSON syntax validation', () => {
    it('should fail for invalid JSON', async () => {
      const invalidJsonFile = path.join(tmpDir, 'invalid.json');
      fs.writeFileSync(invalidJsonFile, '{ invalid json }');

      await assert.rejects(
        async () => {
          await validateCommand(invalidJsonFile);
        },
        {
          code: 1,
        },
        'Should exit with code 1 for invalid JSON'
      );
    });

    it('should pass for valid JSON with mcpServers', async () => {
      const validFile = path.join(tmpDir, 'valid-minimal.json');
      const config = {
        mcpServers: {},
      };
      fs.writeFileSync(validFile, JSON.stringify(config, null, 2));

      // Should not throw
      await validateCommand(validFile);
    });
  });

  describe('schema validation', () => {
    it('should fail when mcpServers object is missing', async () => {
      const noServersFile = path.join(tmpDir, 'no-servers.json');
      fs.writeFileSync(noServersFile, JSON.stringify({}, null, 2));

      await assert.rejects(
        async () => {
          await validateCommand(noServersFile);
        },
        {
          code: 1,
        },
        'Should exit with code 1 when mcpServers is missing'
      );
    });

    it('should fail when mcpServers is not an object', async () => {
      const badServersFile = path.join(tmpDir, 'bad-servers.json');
      fs.writeFileSync(badServersFile, JSON.stringify({ mcpServers: 'not-an-object' }, null, 2));

      await assert.rejects(
        async () => {
          await validateCommand(badServersFile);
        },
        {
          code: 1,
        },
        'Should exit with code 1 when mcpServers is not an object'
      );
    });
  });

  describe('server config validation', () => {
    it('should pass for valid drive server config', async () => {
      const validDriveFile = path.join(tmpDir, 'valid-drive.json');
      const config = {
        mcpServers: {
          drive: {
            command: 'npx',
            args: ['-y', '@mcp-z/mcp-drive'],
            env: {
              GOOGLE_CLIENT_ID: 'test-client-id',
              GOOGLE_CLIENT_SECRET: 'test-client-secret',
              AUTH_MODE: 'loopback-oauth',
              LOG_LEVEL: 'info',
            },
          },
        },
      };
      fs.writeFileSync(validDriveFile, JSON.stringify(config, null, 2));

      // Should not throw
      await validateCommand(validDriveFile);
    });

    it('should fail when command field is missing', async () => {
      const noCommandFile = path.join(tmpDir, 'no-command.json');
      const config = {
        mcpServers: {
          drive: {
            args: ['-y', '@mcp-z/mcp-drive'],
            env: {},
          },
        },
      };
      fs.writeFileSync(noCommandFile, JSON.stringify(config, null, 2));

      await assert.rejects(
        async () => {
          await validateCommand(noCommandFile);
        },
        {
          code: 1,
        },
        'Should exit with code 1 when command field is missing'
      );
    });

    it('should pass when args field is missing (args is optional per standard)', async () => {
      const noArgsFile = path.join(tmpDir, 'no-args.json');
      const config = {
        mcpServers: {
          drive: {
            command: 'npx',
            env: {},
          },
        },
      };
      fs.writeFileSync(noArgsFile, JSON.stringify(config, null, 2));

      // Should not throw - args is optional per .mcp.json standard
      // Will show warning about missing GOOGLE_CLIENT_ID, but that's OK
      await validateCommand(noArgsFile);
    });

    it('should fail when args field is invalid (not an array)', async () => {
      const invalidArgsFile = path.join(tmpDir, 'invalid-args.json');
      const config = {
        mcpServers: {
          drive: {
            command: 'npx',
            args: 'invalid-string-not-array', // Invalid: should be array
            env: {},
          },
        },
      };
      fs.writeFileSync(invalidArgsFile, JSON.stringify(config, null, 2));

      await assert.rejects(
        async () => {
          await validateCommand(invalidArgsFile);
        },
        {
          code: 1,
        },
        'Should exit with code 1 when args field is not an array'
      );
    });

    it('should warn for unknown server packages', async () => {
      const unknownServerFile = path.join(tmpDir, 'unknown-server.json');
      const config = {
        mcpServers: {
          'non-existent-server': {
            command: 'npx',
            args: ['-y', '@mcp-z/server-non-existent'],
            env: {},
          },
        },
      };
      fs.writeFileSync(unknownServerFile, JSON.stringify(config, null, 2));

      // Should pass with warnings (not throw)
      await validateCommand(unknownServerFile);
    });

    it('should warn for missing required environment variables', async () => {
      const missingEnvFile = path.join(tmpDir, 'missing-env.json');
      const config = {
        mcpServers: {
          drive: {
            command: 'npx',
            args: ['-y', '@mcp-z/mcp-drive'],
            env: {
              // Missing GOOGLE_CLIENT_ID which is required
              LOG_LEVEL: 'info',
            },
          },
        },
      };
      fs.writeFileSync(missingEnvFile, JSON.stringify(config, null, 2));

      // Should pass with warnings (not throw)
      await validateCommand(missingEnvFile);
    });

    it('should warn for placeholder environment variables', async () => {
      const placeholderEnvFile = path.join(tmpDir, 'placeholder-env.json');
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing validator detection of ${VAR} placeholder pattern (not a template literal)
      const placeholderString = '${GOOGLE_CLIENT_ID}';
      const config = {
        mcpServers: {
          drive: {
            command: 'npx',
            args: ['-y', '@mcp-z/mcp-drive'],
            env: {
              GOOGLE_CLIENT_ID: placeholderString,
              LOG_LEVEL: 'info',
            },
          },
        },
      };
      fs.writeFileSync(placeholderEnvFile, JSON.stringify(config, null, 2));

      // Should pass with warnings (not throw)
      await validateCommand(placeholderEnvFile);
    });
  });

  describe('HTTP transport validation', () => {
    it('should validate HTTP server configs', async () => {
      const httpServerFile = path.join(tmpDir, 'http-server.json');
      const config = {
        mcpServers: {
          drive: {
            type: 'http',
            command: 'npx',
            args: ['-y', '@mcp-z/mcp-drive'],
            url: 'http://localhost:9001/mcp',
            env: {
              GOOGLE_CLIENT_ID: 'test-client-id',
              GOOGLE_CLIENT_SECRET: 'test-client-secret',
              AUTH_MODE: 'loopback-oauth',
              LOG_LEVEL: 'info',
            },
          },
        },
      };
      fs.writeFileSync(httpServerFile, JSON.stringify(config, null, 2));

      // Should not throw
      await validateCommand(httpServerFile);
    });
  });

  describe('unknown arguments validation', () => {
    it('should warn for unknown command arguments', async () => {
      const unknownArgsFile = path.join(tmpDir, 'unknown-args.json');
      const config = {
        mcpServers: {
          drive: {
            command: 'npx',
            args: ['-y', '@mcp-z/mcp-drive', '--unknown-flag', 'value'],
            env: {
              GOOGLE_CLIENT_ID: 'test-client-id',
              LOG_LEVEL: 'info',
            },
          },
        },
      };
      fs.writeFileSync(unknownArgsFile, JSON.stringify(config, null, 2));

      // Should pass with warnings (not throw)
      await validateCommand(unknownArgsFile);
    });
  });
});
