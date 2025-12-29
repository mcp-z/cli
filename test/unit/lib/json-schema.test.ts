import { getSchema, validateSchema } from '@mcp-z/cli';
import assert from 'assert';

describe('unit/lib/json-schema', () => {
  describe('getSchema', () => {
    it('should return MCP server.json schema', async () => {
      const schema = await getSchema();

      assert.ok(schema, 'Schema should be returned');
      assert.ok('$id' in schema || '$schema' in schema, 'Should be a valid JSON schema');
    });

    it('should cache schema on subsequent calls', async () => {
      const schema1 = await getSchema();
      const schema2 = await getSchema();

      assert.strictEqual(schema1, schema2, 'Should return same cached instance');
    });
  });

  describe('validateSchema', () => {
    it('should accept valid server.json', async () => {
      const validServerJson = {
        name: 'test-org/test-server',
        version: '1.0.0',
        title: 'Test Server',
        description: 'A test MCP server',
        packages: [],
      };

      await validateSchema(validServerJson, 'test-server');
    });

    it('should reject invalid server.json - missing required fields', async () => {
      const invalidServerJson = {
        name: 'test-server',
      };

      await assert.rejects(async () => validateSchema(invalidServerJson, 'test-server'), /Invalid server\.json for 'test-server'/);
    });

    it('should reject invalid server.json - wrong types', async () => {
      const invalidServerJson = {
        name: 123,
        version: '1.0.0',
        title: 'Test',
        description: 'Test',
        packages: [],
      };

      await assert.rejects(async () => validateSchema(invalidServerJson, 'test-server'), /Invalid server\.json/);
    });

    it('should provide detailed error messages', async () => {
      const invalidServerJson = {
        name: 'test',
      };

      try {
        await validateSchema(invalidServerJson, 'test-server');
        assert.fail('Should have thrown');
      } catch (error) {
        const message = (error as Error).message;
        assert.ok(message.includes('Invalid server.json'), 'Should mention invalid server.json');
        assert.ok(message.includes('test-server'), 'Should include server name');
      }
    });

    it('should validate complex server.json with packages', async () => {
      const validServerJson = {
        name: 'test-org/test-server',
        version: '1.0.0',
        title: 'Test Server',
        description: 'A test server',
        packages: [
          {
            registryType: 'npm',
            identifier: '@test-org/test-server',
            transport: {
              type: 'stdio',
            },
            environmentVariables: [],
            packageArguments: [],
          },
        ],
      };

      await validateSchema(validServerJson, 'test-server');
    });

    it('should validate server.json with tools array', async () => {
      const validServerJson = {
        name: 'test-org/test-server',
        version: '1.0.0',
        title: 'Test Server',
        description: 'A test server with tools',
        packages: [],
        tools: [
          {
            name: 'test-tool',
            description: 'A test tool',
          },
        ],
      };

      await validateSchema(validServerJson, 'test-server');
    });
  });
});
