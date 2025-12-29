import { type Combination, createConfigChoices, discoverServerJson, extractServerName, filterConfigChoices, generateConditionalCombinations, generateConfigFile, generateConfigObject, MetadataReader, type ServerMetadata, shouldPromptEnvVar, TRANSPORT_MAP } from '@mcp-z/cli';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// Mock promptForEnvVars to return test values
let mockEnvVarValues: Record<string, string> = {};

// Mock function for testing
const mockPromptForEnvVars = async (_serverName: string, envVars: { name: string }[]) => {
  const result: Record<string, string> = {};
  for (const envVar of envVars) {
    const value = mockEnvVarValues[envVar.name];
    if (value !== undefined) {
      result[envVar.name] = value;
    }
  }
  return result;
};

describe('manifest generate command', () => {
  const tmpDir = path.join('.tmp', 'generate-combinations-tests');

  before(() => {
    // Create temp directory for test files
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    // Clean up temp files
    try {
      // Recursively remove directory and all contents
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_error) {
      // Ignore close errors
    }
  });

  afterEach(() => {
    // Reset mock values
    mockEnvVarValues = {};
  });

  describe('discoverServerJson', () => {
    it('should find server.json in current directory', () => {
      const testDir = path.join(tmpDir, 'test-discover-1');
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'server.json'), '{}');

      const result = discoverServerJson(testDir);
      assert.strictEqual(result, path.join(testDir, 'server.json'));
    });

    it('should find server.json in parent directory', () => {
      const testDir = path.join(tmpDir, 'test-discover-2');
      const childDir = path.join(testDir, 'child');
      fs.mkdirSync(childDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'server.json'), '{}');

      const result = discoverServerJson(childDir);
      assert.strictEqual(result, path.join(testDir, 'server.json'));
    });

    it('should return null when server.json not found', () => {
      const testDir = path.join(tmpDir, 'test-discover-3');
      fs.mkdirSync(testDir, { recursive: true });

      const result = discoverServerJson(testDir);
      assert.strictEqual(result, null);
    });

    it('should prefer current directory over parent', () => {
      const testDir = path.join(tmpDir, 'test-discover-4');
      const childDir = path.join(testDir, 'child');
      fs.mkdirSync(childDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'server.json'), '{}');
      fs.writeFileSync(path.join(childDir, 'server.json'), '{}');

      const result = discoverServerJson(childDir);
      assert.strictEqual(result, path.join(childDir, 'server.json'));
    });
  });

  describe('extractServerName', () => {
    it('should strip org prefix from scoped packages', () => {
      assert.strictEqual(extractServerName('@mcp-z/mcp-gmail'), 'mcp-gmail');
      assert.strictEqual(extractServerName('@org/my-package'), 'my-package');
      assert.strictEqual(extractServerName('@scope/some-tool'), 'some-tool');
    });

    it('should return package name as-is for unscoped packages', () => {
      assert.strictEqual(extractServerName('some-random-package'), 'some-random-package');
      assert.strictEqual(extractServerName('mcp-server'), 'mcp-server');
    });

    it('should return "server" for empty result', () => {
      assert.strictEqual(extractServerName(''), 'server');
    });
  });

  describe('generateConfig', () => {
    const outputDir = path.join(tmpDir, 'generated-configs');

    // Mock server metadata
    const mockMetadata: ServerMetadata = {
      name: 'test-server',
      description: 'Test server',
      version: '1.0.0',
      title: 'Test Server',
      packages: [
        {
          registryType: 'npm',
          identifier: '@mcp-z/server-test',
          transport: { type: 'stdio' },
          environmentVariables: [
            {
              name: 'GOOGLE_CLIENT_ID',
              description: 'Google OAuth client ID',
              isSecret: false,
              isRequired: true,
            },
            {
              name: 'GOOGLE_CLIENT_SECRET',
              description: 'Google OAuth client secret',
              isSecret: true,
              isRequired: true,
            },
            {
              name: 'LOG_LEVEL',
              description: 'Log level',
              isSecret: false,
              value: 'info',
            },
            {
              name: 'AUTH_MODE',
              description: 'Authentication mode',
              isSecret: false,
              choices: ['loopback', 'dcr', 'service-account'],
            },
          ],
          packageArguments: [],
        },
        {
          registryType: 'npm',
          identifier: '@mcp-z/server-test',
          transport: { type: 'streamable-http', url: 'http://localhost:3000/mcp' },
          environmentVariables: [
            {
              name: 'GOOGLE_CLIENT_ID',
              description: 'Google OAuth client ID',
              isSecret: false,
              isRequired: true,
            },
            {
              name: 'GOOGLE_CLIENT_SECRET',
              description: 'Google OAuth client secret',
              isSecret: true,
              isRequired: true,
            },
            {
              name: 'LOG_LEVEL',
              description: 'Log level',
              isSecret: false,
              value: 'info',
            },
            {
              name: 'AUTH_MODE',
              description: 'Authentication mode',
              isSecret: false,
              choices: ['loopback', 'dcr', 'service-account'],
            },
          ],
          packageArguments: [],
        },
      ],
    };

    // Mock metadata reader
    const mockMetadataReader: Pick<MetadataReader, 'readServerMetadata' | 'getPackageForTransport' | 'discoverInstalledServers'> = {
      readServerMetadata: async () => mockMetadata,
      getPackageForTransport: (metadata: ServerMetadata, transport: 'stdio' | 'streamable-http') => {
        return metadata.packages.find((p) => p.transport.type === transport);
      },
      discoverInstalledServers: async () => [],
    };

    beforeEach(() => {
      // Clean output directory before each test
      if (fs.existsSync(outputDir)) {
        const files = fs.readdirSync(outputDir);
        for (const file of files) {
          fs.unlinkSync(path.join(outputDir, file));
        }
      }
      fs.mkdirSync(outputDir, { recursive: true });
    });

    it('should generate stdio config with real values from prompts', async () => {
      // Mock user input for environment variables
      mockEnvVarValues = {
        GOOGLE_CLIENT_ID: 'test-client-id-12345',
        GOOGLE_CLIENT_SECRET: 'test-client-secret-67890',
        LOG_LEVEL: 'info',
        AUTH_MODE: 'loopback',
      };

      const combination: Combination = {
        name: 'loopback',
        envKeys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'LOG_LEVEL', 'AUTH_MODE'],
        argNames: [],
        defaults: {},
        argDefaults: {},
        dimensionValues: {},
      };

      await generateConfigFile(
        {
          serverName: 'gmail',
          combination,
          transport: 'stdio',
          outputDir,
          packageName: '@mcp-z/mcp-gmail',
          metadata: mockMetadata,
          metadataReader: mockMetadataReader,
        },
        mockPromptForEnvVars
      );

      const configPath = path.join(outputDir, '.mcp.loopback-stdio.json');
      assert.ok(fs.existsSync(configPath), 'Config file should be created');

      const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.deepStrictEqual(content, {
        mcpServers: {
          gmail: {
            command: 'npx',
            args: ['-y', '@mcp-z/mcp-gmail'],
            env: {
              GOOGLE_CLIENT_ID: 'test-client-id-12345',
              GOOGLE_CLIENT_SECRET: 'test-client-secret-67890',
              LOG_LEVEL: 'info',
              AUTH_MODE: 'loopback',
            },
          },
        },
      });
    });

    it('should generate http config with type and url', async () => {
      mockEnvVarValues = {
        GOOGLE_CLIENT_ID: 'test-client-id-12345',
        GOOGLE_CLIENT_SECRET: 'test-client-secret-67890',
        LOG_LEVEL: 'info',
        AUTH_MODE: 'dcr',
      };

      const combination: Combination = {
        name: 'dcr',
        envKeys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'LOG_LEVEL', 'AUTH_MODE'],
        argNames: [],
        defaults: {},
        argDefaults: {},
        dimensionValues: {},
      };

      await generateConfigFile(
        {
          serverName: 'gmail',
          combination,
          transport: 'http',
          outputDir,
          packageName: '@mcp-z/mcp-gmail',
          metadata: mockMetadata,
          metadataReader: mockMetadataReader,
        },
        mockPromptForEnvVars
      );

      const configPath = path.join(outputDir, '.mcp.dcr-http.json');
      assert.ok(fs.existsSync(configPath), 'Config file should be created');

      const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.deepStrictEqual(content, {
        mcpServers: {
          gmail: {
            type: 'http',
            url: 'http://localhost:3000/mcp',
            start: {
              command: 'npx',
              args: ['-y', '@mcp-z/mcp-gmail', '--port', '3000'],
              env: {
                GOOGLE_CLIENT_ID: 'test-client-id-12345',
                GOOGLE_CLIENT_SECRET: 'test-client-secret-67890',
                LOG_LEVEL: 'info',
                AUTH_MODE: 'dcr',
              },
            },
          },
        },
      });
    });

    it('should filter env vars based on combination envKeys', async () => {
      // Only provide values for the envKeys in the combination
      mockEnvVarValues = {
        LOG_LEVEL: 'debug',
      };

      const combination: Combination = {
        name: 'minimal',
        envKeys: ['LOG_LEVEL'], // Only include LOG_LEVEL
        argNames: [],
        defaults: {},
        argDefaults: {},
        dimensionValues: {},
      };

      await generateConfigFile(
        {
          serverName: 'test',
          combination,
          transport: 'stdio',
          outputDir,
          packageName: '@mcp-z/server-test',
          metadata: mockMetadata,
          metadataReader: mockMetadataReader,
        },
        mockPromptForEnvVars
      );

      const configPath = path.join(outputDir, '.mcp.minimal-stdio.json');
      assert.ok(fs.existsSync(configPath), 'Config file should be created');

      const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      // Should only have LOG_LEVEL, not the other env vars
      assert.deepStrictEqual(Object.keys(content.mcpServers.test.env), ['LOG_LEVEL']);
      assert.strictEqual(content.mcpServers.test.env.LOG_LEVEL, 'debug');
    });

    it('should generate valid JSON with trailing newline', async () => {
      mockEnvVarValues = {
        LOG_LEVEL: 'info',
      };

      const combination: Combination = {
        name: 'test',
        envKeys: ['LOG_LEVEL'],
        argNames: [],
        defaults: {},
        argDefaults: {},
        dimensionValues: {},
      };

      await generateConfigFile(
        {
          serverName: 'test',
          combination,
          transport: 'stdio',
          outputDir,
          packageName: '@mcp-z/server-test',
          metadata: mockMetadata,
          metadataReader: mockMetadataReader,
        },
        mockPromptForEnvVars
      );

      const configPath = path.join(outputDir, '.mcp.test-stdio.json');
      const content = fs.readFileSync(configPath, 'utf-8');

      // Should end with newline
      assert.ok(content.endsWith('\n'), 'Config should end with newline');

      // Should be valid JSON
      assert.doesNotThrow(() => JSON.parse(content), 'Should be valid JSON');

      // Should be formatted with 2-space indentation
      assert.ok(content.includes('  "mcpServers"'), 'Should use 2-space indentation');
    });
  });

  describe('generateConfig with package arguments', () => {
    it('should include package arguments in generated config', async () => {
      const outputDir = path.join(tmpDir, 'arg-test-1');
      fs.mkdirSync(outputDir, { recursive: true });

      mockEnvVarValues = {
        GOOGLE_CLIENT_ID: 'test-client-id',
      };

      const combination: Combination = {
        name: 'test-args',
        envKeys: ['GOOGLE_CLIENT_ID'],
        argNames: ['--auth', '--log-level'],
        defaults: {},
        argDefaults: { '--auth': 'loopback-oauth', '--log-level': 'debug' },
        dimensionValues: {},
      };

      const mockMetadata: ServerMetadata = {
        name: 'test-server',
        description: 'Test',
        version: '1.0.0',
        title: 'Test',
        packages: [
          {
            registryType: 'npm',
            identifier: '@test/server',
            transport: { type: 'stdio' },
            environmentVariables: [{ name: 'GOOGLE_CLIENT_ID', description: 'Test', isSecret: false }],
            packageArguments: [
              { type: 'named', name: '--auth', description: 'Auth mode', choices: ['loopback-oauth', 'dcr'] },
              { type: 'named', name: '--log-level', description: 'Log level', choices: ['debug', 'info', 'warn'] },
            ],
          },
        ],
      };

      const mockReader: Pick<MetadataReader, 'getPackageForTransport'> = {
        getPackageForTransport: (metadata: ServerMetadata, transport: string) => {
          return metadata.packages.find((p) => p.transport.type === transport);
        },
      };

      await generateConfigFile(
        {
          serverName: 'test',
          combination,
          transport: 'stdio',
          outputDir,
          packageName: '@test/server',
          metadata: mockMetadata,
          metadataReader: mockReader,
        },
        mockPromptForEnvVars
      );

      const configPath = path.join(outputDir, '.mcp.test-args-stdio.json');
      assert.ok(fs.existsSync(configPath), 'Config file should be created');

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.ok(config.mcpServers.test, 'Should have test server');

      // Check that package arguments are in args array
      const args = config.mcpServers.test.args;
      assert.ok(args.includes('--auth'), 'Should include --auth argument');
      assert.ok(args.includes('loopback-oauth'), 'Should include --auth value');
      assert.ok(args.includes('--log-level'), 'Should include --log-level argument');
      assert.ok(args.includes('debug'), 'Should include --log-level value');
    });

    it('should separate env dimensions from arg dimensions', async () => {
      const outputDir = path.join(tmpDir, 'arg-test-2');
      fs.mkdirSync(outputDir, { recursive: true });

      mockEnvVarValues = {
        GOOGLE_CLIENT_ID: 'test-client-id',
      };

      const combination: Combination = {
        name: 'mixed-dimensions',
        envKeys: ['GOOGLE_CLIENT_ID', 'AUTH_MODE'],
        argNames: ['--log-level'],
        defaults: {},
        argDefaults: {},
        dimensionValues: {
          AUTH_MODE: 'loopback-oauth', // This is an env var
          '--log-level': 'debug', // This is an arg
        },
      };

      const mockMetadata: ServerMetadata = {
        name: 'test-server',
        description: 'Test',
        version: '1.0.0',
        title: 'Test',
        packages: [
          {
            registryType: 'npm',
            identifier: '@test/server',
            transport: { type: 'stdio' },
            environmentVariables: [
              { name: 'GOOGLE_CLIENT_ID', description: 'Test', isSecret: false },
              { name: 'AUTH_MODE', description: 'Test', isSecret: false, choices: ['loopback-oauth', 'dcr'] },
            ],
            packageArguments: [{ type: 'named', name: '--log-level', description: 'Log level', choices: ['debug', 'info'] }],
          },
        ],
      };

      const mockReader: Pick<MetadataReader, 'getPackageForTransport'> = {
        getPackageForTransport: (metadata: ServerMetadata, transport: string) => {
          return metadata.packages.find((p) => p.transport.type === transport);
        },
      };

      await generateConfigFile(
        {
          serverName: 'test',
          combination,
          transport: 'stdio',
          outputDir,
          packageName: '@test/server',
          metadata: mockMetadata,
          metadataReader: mockReader,
        },
        mockPromptForEnvVars
      );

      const configPath = path.join(outputDir, '.mcp.mixed-dimensions-stdio.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      // ENV dimension should be in env object
      assert.strictEqual(config.mcpServers.test.env.AUTH_MODE, 'loopback-oauth');

      // ARG dimension should be in args array
      const args = config.mcpServers.test.args;
      assert.ok(args.includes('--log-level'));
      assert.ok(args.includes('debug'));
    });
  });

  describe('generateConfig with skip values', () => {
    it('should filter out skip values from combination names', async () => {
      const outputDir = path.join(tmpDir, 'skip-test-1');
      fs.mkdirSync(outputDir, { recursive: true });

      mockEnvVarValues = {
        GOOGLE_CLIENT_ID: 'test-client-id',
      };

      // Combination where one dimension is skipped
      const combination: Combination = {
        name: 'defaults', // When skip values are filtered out, name becomes 'defaults'
        envKeys: ['GOOGLE_CLIENT_ID', 'AUTH_MODE', 'LOG_LEVEL'],
        argNames: [],
        defaults: {},
        argDefaults: {},
        dimensionValues: {
          // AUTH_MODE and LOG_LEVEL were skipped, so not in dimensionValues
        },
      };

      const mockMetadata: ServerMetadata = {
        name: 'test-server',
        description: 'Test',
        version: '1.0.0',
        title: 'Test',
        packages: [
          {
            registryType: 'npm',
            identifier: '@test/server',
            transport: { type: 'stdio' },
            environmentVariables: [
              { name: 'GOOGLE_CLIENT_ID', description: 'Test', isSecret: false },
              { name: 'AUTH_MODE', description: 'Test', isSecret: false, choices: ['loopback-oauth', 'dcr'] },
              { name: 'LOG_LEVEL', description: 'Test', isSecret: false, choices: ['debug', 'info'] },
            ],
            packageArguments: [],
          },
        ],
      };

      const mockReader: Pick<MetadataReader, 'getPackageForTransport'> = {
        getPackageForTransport: (metadata: ServerMetadata, transport: string) => {
          return metadata.packages.find((p) => p.transport.type === transport);
        },
      };

      await generateConfigFile(
        {
          serverName: 'test',
          combination,
          transport: 'stdio',
          outputDir,
          packageName: '@test/server',
          metadata: mockMetadata,
          metadataReader: mockReader,
        },
        mockPromptForEnvVars
      );

      const configPath = path.join(outputDir, '.mcp.defaults-stdio.json');
      assert.ok(fs.existsSync(configPath), 'Config file should be created with "defaults" name');

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.ok(config.mcpServers.test, 'Should have test server');

      // Should only have CLIENT_ID in env (AUTH_MODE and LOG_LEVEL were skipped)
      assert.ok(config.mcpServers.test.env.GOOGLE_CLIENT_ID);
      assert.strictEqual(config.mcpServers.test.env.AUTH_MODE, undefined);
      assert.strictEqual(config.mcpServers.test.env.LOG_LEVEL, undefined);
    });

    it('should handle partial skip in combination names', async () => {
      const outputDir = path.join(tmpDir, 'skip-test-2');
      fs.mkdirSync(outputDir, { recursive: true });

      mockEnvVarValues = {
        GOOGLE_CLIENT_ID: 'test-client-id',
      };

      // One value is set, one is skipped
      const combination: Combination = {
        name: 'loopback', // Only loopback-oauth is in the name (LOG_LEVEL was skipped)
        envKeys: ['GOOGLE_CLIENT_ID', 'AUTH_MODE', 'LOG_LEVEL'],
        argNames: [],
        defaults: {},
        argDefaults: {},
        dimensionValues: {
          AUTH_MODE: 'loopback-oauth', // This is set
          // LOG_LEVEL is skipped (not in dimensionValues)
        },
      };

      const mockMetadata: ServerMetadata = {
        name: 'test-server',
        description: 'Test',
        version: '1.0.0',
        title: 'Test',
        packages: [
          {
            registryType: 'npm',
            identifier: '@test/server',
            transport: { type: 'stdio' },
            environmentVariables: [
              { name: 'GOOGLE_CLIENT_ID', description: 'Test', isSecret: false },
              { name: 'AUTH_MODE', description: 'Test', isSecret: false, choices: ['loopback-oauth', 'dcr'] },
              { name: 'LOG_LEVEL', description: 'Test', isSecret: false, choices: ['debug', 'info'] },
            ],
            packageArguments: [],
          },
        ],
      };

      const mockReader: Pick<MetadataReader, 'getPackageForTransport'> = {
        getPackageForTransport: (metadata: ServerMetadata, transport: string) => {
          return metadata.packages.find((p) => p.transport.type === transport);
        },
      };

      await generateConfigFile(
        {
          serverName: 'test',
          combination,
          transport: 'stdio',
          outputDir,
          packageName: '@test/server',
          metadata: mockMetadata,
          metadataReader: mockReader,
        },
        mockPromptForEnvVars
      );

      const configPath = path.join(outputDir, '.mcp.loopback-stdio.json');
      assert.ok(fs.existsSync(configPath), 'Config file should be created with partial name');

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      // Should have AUTH_MODE in env
      assert.strictEqual(config.mcpServers.test.env.AUTH_MODE, 'loopback-oauth');

      // Should NOT have LOG_LEVEL (was skipped)
      assert.strictEqual(config.mcpServers.test.env.LOG_LEVEL, undefined);
    });
  });

  describe('generateConfig with HTTP transport and args', () => {
    it('should add package arguments to HTTP start block', async () => {
      const outputDir = path.join(tmpDir, 'http-args-test');
      fs.mkdirSync(outputDir, { recursive: true });

      mockEnvVarValues = {
        GOOGLE_CLIENT_ID: 'test-client-id',
      };

      const combination: Combination = {
        name: 'http-test',
        envKeys: ['GOOGLE_CLIENT_ID'],
        argNames: ['--auth', '--base-url'],
        defaults: {},
        argDefaults: { '--auth': 'dcr' },
        dimensionValues: { '--base-url': 'http://localhost:9005' },
      };

      const mockMetadata: ServerMetadata = {
        name: 'test-server',
        description: 'Test',
        version: '1.0.0',
        title: 'Test',
        packages: [
          {
            registryType: 'npm',
            identifier: '@test/server',
            transport: { type: 'streamable-http', url: 'http://localhost:3000/mcp' },
            environmentVariables: [{ name: 'GOOGLE_CLIENT_ID', description: 'Test', isSecret: false }],
            packageArguments: [
              { type: 'named', name: '--auth', description: 'Auth mode', choices: ['dcr', 'loopback-oauth'] },
              { type: 'named', name: '--base-url', description: 'Base URL', choices: ['http://localhost:9005', 'http://localhost:8080'] },
            ],
          },
        ],
      };

      const mockReader: Pick<MetadataReader, 'getPackageForTransport'> = {
        getPackageForTransport: (metadata: ServerMetadata, transport: string) => {
          return metadata.packages.find((p) => p.transport.type === transport);
        },
      };

      await generateConfigFile(
        {
          serverName: 'test',
          combination,
          transport: 'http',
          outputDir,
          packageName: '@test/server',
          metadata: mockMetadata,
          metadataReader: mockReader,
          httpHost: 'localhost',
          httpPort: 3000,
        },
        mockPromptForEnvVars
      );

      const configPath = path.join(outputDir, '.mcp.http-test-http.json');
      assert.ok(fs.existsSync(configPath), 'HTTP config file should be created');

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      // HTTP config should have start block
      assert.ok(config.mcpServers.test.start, 'Should have start block');

      // Package arguments should be in start.args
      const args = config.mcpServers.test.start.args;
      assert.ok(args.includes('--auth'), 'Should include --auth in start args');
      assert.ok(args.includes('dcr'), 'Should include --auth value in start args');
      assert.ok(args.includes('--base-url'), 'Should include --base-url in start args');
      assert.ok(args.includes('http://localhost:9005'), 'Should include --base-url value in start args');

      // Should also have --port flag (but NOT --http)
      assert.ok(args.includes('--port'), 'Should include --port flag');
      assert.ok(args.includes('3000'), 'Should include port value');
      assert.ok(!args.includes('--http'), 'Should NOT include --http flag (auto-detected from --port)');
    });
  });

  describe('generateConfig with empty env', () => {
    const outputDir = path.join(tmpDir, 'empty-env-test');

    beforeEach(() => {
      // Clean output directory before each test
      if (fs.existsSync(outputDir)) {
        const files = fs.readdirSync(outputDir);
        for (const file of files) {
          fs.unlinkSync(path.join(outputDir, file));
        }
      }
      fs.mkdirSync(outputDir, { recursive: true });
    });

    it('should omit env field when no environment variables configured', async () => {
      const combination: Combination = {
        name: 'minimal',
        envKeys: [], // No env vars
        argNames: [],
        defaults: {},
        argDefaults: {},
        dimensionValues: {},
      };

      const mockMetadata: ServerMetadata = {
        name: 'test',
        description: 'Test server',
        version: '1.0.0',
        title: 'Test Server',
        packages: [
          {
            registryType: 'npm',
            identifier: '@test/server',
            transport: { type: 'stdio' },
            runtimeHint: 'npx',
            runtimeArguments: [],
            environmentVariables: [],
            packageArguments: [],
          },
        ],
      };

      const mockReader: Pick<MetadataReader, 'getPackageForTransport'> = {
        getPackageForTransport: (metadata: ServerMetadata, transport: string) => {
          return metadata.packages.find((p) => p.transport.type === transport);
        },
      };

      await generateConfigFile(
        {
          serverName: 'test',
          combination,
          transport: 'stdio',
          outputDir,
          packageName: '@test/server',
          metadata: mockMetadata,
          metadataReader: mockReader,
        },
        mockPromptForEnvVars
      );

      const configPath = path.join(outputDir, '.mcp.minimal-stdio.json');
      const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      // Verify env field is NOT present (not just empty)
      assert.ok(!('env' in content.mcpServers.test), 'env field should not be present when no env vars configured');
      assert.deepStrictEqual(content, {
        mcpServers: {
          test: {
            command: 'npx',
            args: ['-y', '@test/server'],
          },
        },
      });
    });

    it('should omit env field in HTTP start block when no environment variables configured', async () => {
      const combination: Combination = {
        name: 'minimal',
        envKeys: [],
        argNames: [],
        defaults: {},
        argDefaults: {},
        dimensionValues: {},
      };

      const mockMetadata: ServerMetadata = {
        name: 'test',
        description: 'Test server',
        version: '1.0.0',
        title: 'Test Server',
        packages: [
          {
            registryType: 'npm',
            identifier: '@test/server',
            transport: { type: 'streamable-http' },
            runtimeHint: 'npx',
            runtimeArguments: [],
            environmentVariables: [],
            packageArguments: [],
          },
        ],
      };

      const mockReader: Pick<MetadataReader, 'getPackageForTransport'> = {
        getPackageForTransport: (metadata: ServerMetadata, transport: string) => {
          return metadata.packages.find((p) => p.transport.type === transport);
        },
      };

      await generateConfigFile(
        {
          serverName: 'test',
          combination,
          transport: 'http',
          outputDir,
          packageName: '@test/server',
          metadata: mockMetadata,
          metadataReader: mockReader,
          httpHost: 'localhost',
          httpPort: 3000,
        },
        mockPromptForEnvVars
      );

      const configPath = path.join(outputDir, '.mcp.minimal-http.json');
      const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      // Verify env field is NOT present in start block
      assert.ok(!('env' in content.mcpServers.test.start), 'env field should not be present in start block when no env vars configured');
      assert.deepStrictEqual(content, {
        mcpServers: {
          test: {
            type: 'http',
            url: 'http://localhost:3000/mcp',
            start: {
              command: 'npx',
              args: ['-y', '@test/server', '--port', '3000'],
            },
          },
        },
      });
    });
  });

  describe('generateConfig with output directory handling', () => {
    it('should write config to specific output directory', async () => {
      const outputDir = path.resolve(tmpDir, 'specific-output');

      mockEnvVarValues = {
        GOOGLE_CLIENT_ID: 'test-client-id',
      };

      const combination: Combination = {
        name: 'test',
        envKeys: ['GOOGLE_CLIENT_ID'],
        argNames: [],
        defaults: {},
        argDefaults: {},
        dimensionValues: {},
      };

      const mockMetadata: ServerMetadata = {
        name: 'test',
        description: 'Test',
        version: '1.0.0',
        title: 'Test',
        packages: [
          {
            registryType: 'npm',
            identifier: '@test/server',
            transport: { type: 'stdio' },
            environmentVariables: [{ name: 'GOOGLE_CLIENT_ID', description: 'Test', isSecret: false }],
            packageArguments: [],
          },
        ],
      };

      const mockReader: Pick<MetadataReader, 'getPackageForTransport'> = {
        getPackageForTransport: (metadata: ServerMetadata, transport: string) => {
          return metadata.packages.find((p) => p.transport.type === transport);
        },
      };

      await generateConfigFile(
        {
          serverName: 'test',
          combination,
          transport: 'stdio',
          outputDir,
          packageName: '@test/server',
          metadata: mockMetadata,
          metadataReader: mockReader,
        },
        mockPromptForEnvVars
      );

      const configPath = path.join(outputDir, '.mcp.test-stdio.json');
      assert.ok(fs.existsSync(configPath), 'Config should be created in specified directory');

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.ok(config.mcpServers.test, 'Config should be valid');
    });

    it('should create output directory if it does not exist', async () => {
      const outputDir = path.join(tmpDir, 'new-directory', 'nested', 'deep');

      // Verify directory doesn't exist yet
      assert.ok(!fs.existsSync(outputDir), 'Output directory should not exist yet');

      mockEnvVarValues = {
        GOOGLE_CLIENT_ID: 'test-client-id',
      };

      const combination: Combination = {
        name: 'test',
        envKeys: ['GOOGLE_CLIENT_ID'],
        argNames: [],
        defaults: {},
        argDefaults: {},
        dimensionValues: {},
      };

      const mockMetadata: ServerMetadata = {
        name: 'test',
        description: 'Test',
        version: '1.0.0',
        title: 'Test',
        packages: [
          {
            registryType: 'npm',
            identifier: '@test/server',
            transport: { type: 'stdio' },
            environmentVariables: [{ name: 'GOOGLE_CLIENT_ID', description: 'Test', isSecret: false }],
            packageArguments: [],
          },
        ],
      };

      const mockReader: Pick<MetadataReader, 'getPackageForTransport'> = {
        getPackageForTransport: (metadata: ServerMetadata, transport: string) => {
          return metadata.packages.find((p) => p.transport.type === transport);
        },
      };

      await generateConfigFile(
        {
          serverName: 'test',
          combination,
          transport: 'stdio',
          outputDir,
          packageName: '@test/server',
          metadata: mockMetadata,
          metadataReader: mockReader,
        },
        mockPromptForEnvVars
      );

      // Verify directory was created
      assert.ok(fs.existsSync(outputDir), 'Output directory should be created');

      const configPath = path.join(outputDir, '.mcp.test-stdio.json');
      assert.ok(fs.existsSync(configPath), 'Config should be created in new directory');

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.ok(config.mcpServers.test, 'Config should be valid');
    });

    it('should handle custom directory paths', async () => {
      const outputDir = path.join(tmpDir, 'custom-configs');

      mockEnvVarValues = {
        GOOGLE_CLIENT_ID: 'test-client-id',
      };

      const combination: Combination = {
        name: 'custom-test',
        envKeys: ['GOOGLE_CLIENT_ID'],
        argNames: [],
        defaults: {},
        argDefaults: {},
        dimensionValues: {},
      };

      const mockMetadata: ServerMetadata = {
        name: 'test',
        description: 'Test',
        version: '1.0.0',
        title: 'Test',
        packages: [
          {
            registryType: 'npm',
            identifier: '@test/server',
            transport: { type: 'stdio' },
            environmentVariables: [{ name: 'GOOGLE_CLIENT_ID', description: 'Test', isSecret: false }],
            packageArguments: [],
          },
        ],
      };

      const mockReader: Pick<MetadataReader, 'getPackageForTransport'> = {
        getPackageForTransport: (metadata: ServerMetadata, transport: string) => {
          return metadata.packages.find((p) => p.transport.type === transport);
        },
      };

      await generateConfigFile(
        {
          serverName: 'test',
          combination,
          transport: 'stdio',
          outputDir,
          packageName: '@test/server',
          metadata: mockMetadata,
          metadataReader: mockReader,
        },
        mockPromptForEnvVars
      );

      const configPath = path.join(outputDir, '.mcp.custom-test-stdio.json');
      assert.ok(fs.existsSync(configPath), 'Config should be created in custom directory');

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.ok(config.mcpServers.test, 'Config should be valid');
    });
  });

  describe('generateConfig with non-mandatory matrix items', () => {
    it('should exclude env vars with isMandatoryForMatrix: false from dimensions', async () => {
      const outputDir = path.resolve(tmpDir, 'non-mandatory-test');
      fs.mkdirSync(outputDir, { recursive: true });

      // Create server.json with both mandatory and non-mandatory env vars
      const testServerJson = {
        name: 'test-server',
        version: '1.0.0',
        title: 'Test Server',
        description: 'Test server for matrix filtering',
        packages: [
          {
            registryType: 'npm',
            identifier: 'test-org/test-server',
            transport: { type: 'stdio' as const },
            environmentVariables: [
              {
                name: 'AUTH_MODE',
                description: 'Authentication mode',
                choices: ['oauth', 'service-account'],
                isSecret: false,
                isMandatoryForMatrix: true, // Should be included in matrix
              },
              {
                name: 'LOG_LEVEL',
                description: 'Logging level',
                choices: ['debug', 'info', 'warn'],
                isSecret: false,
                isMandatoryForMatrix: false, // Should NOT be included in matrix
              },
            ],
            packageArguments: [],
          },
        ],
      };

      const serverJsonPath = path.join(outputDir, 'server.json');
      fs.writeFileSync(serverJsonPath, JSON.stringify(testServerJson, null, 2));

      // Mock server.json discovery to use our test file
      const originalCwd = process.cwd();
      process.chdir(outputDir);

      try {
        // Create package.json
        const packageJson = {
          name: 'test-org/test-server',
          version: '1.0.0',
          bin: './bin/server.js',
        };
        fs.writeFileSync(path.join(outputDir, 'package.json'), JSON.stringify(packageJson, null, 2));

        // Generate config with mocked prompts (skipping interactive mode)
        mockEnvVarValues = {
          AUTH_MODE: 'oauth',
          LOG_LEVEL: 'info', // Should be available as default, but not in matrix
        };

        const config = await generateConfigObject({
          serverName: 'test',
          combination: {
            name: 'oauth-stdio',
            envKeys: ['AUTH_MODE', 'LOG_LEVEL'],
            argNames: [],
            defaults: { LOG_LEVEL: 'info' }, // LOG_LEVEL as default (not dimension)
            argDefaults: {},
            dimensionValues: { AUTH_MODE: 'oauth' }, // Only AUTH_MODE as dimension
          },
          transport: 'stdio',
          packageName: 'test-org/test-server',
          metadata: testServerJson,
          metadataReader: new MetadataReader(),
        });

        // Verify config has LOG_LEVEL from defaults
        const serverConfig = config.mcpServers.test;
        assert.ok(serverConfig, 'Config should have test server');
        assert.ok('env' in serverConfig && serverConfig.env, 'Config should have env');
        if ('env' in serverConfig && serverConfig.env) {
          assert.strictEqual(serverConfig.env.LOG_LEVEL, 'info', 'LOG_LEVEL should be set from defaults');
          assert.strictEqual(serverConfig.env.AUTH_MODE, 'oauth', 'AUTH_MODE should be set from dimensions');
        }
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should include env vars with isMandatoryForMatrix: true in dimensions', async () => {
      const outputDir = path.resolve(tmpDir, 'mandatory-test');
      fs.mkdirSync(outputDir, { recursive: true });

      const testServerJson = {
        name: 'test-server',
        version: '1.0.0',
        title: 'Test Server',
        description: 'Test server',
        packages: [
          {
            registryType: 'npm',
            identifier: 'test-org/test-server',
            transport: { type: 'stdio' as const },
            environmentVariables: [
              {
                name: 'AUTH_MODE',
                description: 'Authentication mode',
                choices: ['oauth', 'api-key'],
                isSecret: false,
                isMandatoryForMatrix: true,
              },
              {
                name: 'DCR_MODE',
                description: 'DCR mode',
                choices: ['self-hosted', 'external'],
                isSecret: false,
                isMandatoryForMatrix: true,
              },
            ],
            packageArguments: [],
          },
        ],
      };

      const serverJsonPath = path.join(outputDir, 'server.json');
      fs.writeFileSync(serverJsonPath, JSON.stringify(testServerJson, null, 2));

      const originalCwd = process.cwd();
      process.chdir(outputDir);

      try {
        const packageJson = {
          name: 'test-org/test-server',
          version: '1.0.0',
          bin: './bin/server.js',
        };
        fs.writeFileSync(path.join(outputDir, 'package.json'), JSON.stringify(packageJson, null, 2));

        mockEnvVarValues = {
          AUTH_MODE: 'oauth',
          DCR_MODE: 'self-hosted',
        };

        const config = await generateConfigObject({
          serverName: 'test',
          combination: {
            name: 'oauth-self-hosted-stdio',
            envKeys: ['AUTH_MODE', 'DCR_MODE'],
            argNames: [],
            defaults: {},
            argDefaults: {},
            dimensionValues: {
              AUTH_MODE: 'oauth',
              DCR_MODE: 'self-hosted',
            },
          },
          transport: 'stdio',
          packageName: 'test-org/test-server',
          metadata: testServerJson,
          metadataReader: new MetadataReader(),
        });

        const serverConfig = config.mcpServers.test;
        assert.ok(serverConfig, 'Config should have test server');
        assert.ok('env' in serverConfig && serverConfig.env, 'Config should have env');
        if ('env' in serverConfig && serverConfig.env) {
          assert.strictEqual(serverConfig.env.AUTH_MODE, 'oauth');
          assert.strictEqual(serverConfig.env.DCR_MODE, 'self-hosted');
        }
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should include env vars without isMandatoryForMatrix field (default behavior)', async () => {
      const outputDir = path.resolve(tmpDir, 'default-behavior-test');
      fs.mkdirSync(outputDir, { recursive: true });

      const testServerJson = {
        name: 'test-server',
        version: '1.0.0',
        title: 'Test Server',
        description: 'Test server',
        packages: [
          {
            registryType: 'npm',
            identifier: 'test-org/test-server',
            transport: { type: 'stdio' as const },
            environmentVariables: [
              {
                name: 'MODE',
                description: 'Mode',
                choices: ['dev', 'prod'],
                isSecret: false,
                // No isMandatoryForMatrix field - should default to true
              },
            ],
            packageArguments: [],
          },
        ],
      };

      const serverJsonPath = path.join(outputDir, 'server.json');
      fs.writeFileSync(serverJsonPath, JSON.stringify(testServerJson, null, 2));

      const originalCwd = process.cwd();
      process.chdir(outputDir);

      try {
        const packageJson = {
          name: 'test-org/test-server',
          version: '1.0.0',
          bin: './bin/server.js',
        };
        fs.writeFileSync(path.join(outputDir, 'package.json'), JSON.stringify(packageJson, null, 2));

        mockEnvVarValues = { MODE: 'dev' };

        const config = await generateConfigObject({
          serverName: 'test',
          combination: {
            name: 'dev-stdio',
            envKeys: ['MODE'],
            argNames: [],
            defaults: {},
            argDefaults: {},
            dimensionValues: { MODE: 'dev' },
          },
          transport: 'stdio',
          packageName: 'test-org/test-server',
          metadata: testServerJson,
          metadataReader: new MetadataReader(),
        });

        const serverConfig = config.mcpServers.test;
        assert.ok(serverConfig, 'Config should have test server');
        assert.ok('env' in serverConfig && serverConfig.env, 'Config should have env');
        if ('env' in serverConfig && serverConfig.env) {
          assert.strictEqual(serverConfig.env.MODE, 'dev', 'MODE should be included by default');
        }
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('TRANSPORT_MAP', () => {
    it('should map "stdio" to "stdio"', () => {
      assert.strictEqual(TRANSPORT_MAP.stdio, 'stdio');
    });

    it('should map "http" to "streamable-http"', () => {
      assert.strictEqual(TRANSPORT_MAP.http, 'streamable-http');
    });

    it('should only contain stdio and http mappings', () => {
      assert.deepStrictEqual(Object.keys(TRANSPORT_MAP).sort(), ['http', 'stdio']);
    });
  });

  describe('shouldPromptEnvVar', () => {
    it('should return true for env vars without dependsOn', () => {
      const envVar = {}; // No dependsOn field
      assert.strictEqual(shouldPromptEnvVar(envVar, {}), true);
    });

    it('should return true when all dependencies are satisfied', () => {
      const envVar = { dependsOn: { AUTH_MODE: ['dcr'] } };
      const selectedValues = { AUTH_MODE: 'dcr' };
      assert.strictEqual(shouldPromptEnvVar(envVar, selectedValues), true);
    });

    it('should return false when dependency value not in allowed list', () => {
      const envVar = { dependsOn: { AUTH_MODE: ['dcr'] } };
      const selectedValues = { AUTH_MODE: 'loopback-oauth' };
      assert.strictEqual(shouldPromptEnvVar(envVar, selectedValues), false);
    });

    it('should return false when dependency not yet selected', () => {
      const envVar = { dependsOn: { AUTH_MODE: ['dcr'] } };
      const selectedValues = {};
      assert.strictEqual(shouldPromptEnvVar(envVar, selectedValues), false);
    });

    it('should handle multiple allowed values', () => {
      const envVar = { dependsOn: { AUTH_MODE: ['loopback-oauth', 'dcr'] } };
      assert.strictEqual(shouldPromptEnvVar(envVar, { AUTH_MODE: 'loopback-oauth' }), true);
      assert.strictEqual(shouldPromptEnvVar(envVar, { AUTH_MODE: 'dcr' }), true);
      assert.strictEqual(shouldPromptEnvVar(envVar, { AUTH_MODE: 'service-account' }), false);
    });

    it('should require ALL dependencies to be satisfied (AND logic)', () => {
      const envVar = { dependsOn: { AUTH_MODE: ['dcr'], DCR_MODE: ['external'] } };

      // Both satisfied
      assert.strictEqual(shouldPromptEnvVar(envVar, { AUTH_MODE: 'dcr', DCR_MODE: 'external' }), true);

      // Only one satisfied
      assert.strictEqual(shouldPromptEnvVar(envVar, { AUTH_MODE: 'dcr', DCR_MODE: 'self-hosted' }), false);
      assert.strictEqual(shouldPromptEnvVar(envVar, { AUTH_MODE: 'loopback-oauth', DCR_MODE: 'external' }), false);

      // Neither satisfied
      assert.strictEqual(shouldPromptEnvVar(envVar, { AUTH_MODE: 'loopback-oauth' }), false);
    });

    it('should handle real mcp-drive DCR_VERIFY_URL case', () => {
      // DCR_VERIFY_URL only shows when AUTH_MODE=dcr AND DCR_MODE=external
      const envVar = { dependsOn: { AUTH_MODE: ['dcr'], DCR_MODE: ['external'] } };

      // Show for dcr + external
      assert.strictEqual(shouldPromptEnvVar(envVar, { AUTH_MODE: 'dcr', DCR_MODE: 'external' }), true);

      // Hide for dcr + self-hosted
      assert.strictEqual(shouldPromptEnvVar(envVar, { AUTH_MODE: 'dcr', DCR_MODE: 'self-hosted' }), false);

      // Hide for loopback-oauth (regardless of DCR_MODE)
      assert.strictEqual(shouldPromptEnvVar(envVar, { AUTH_MODE: 'loopback-oauth' }), false);
    });
  });

  describe('createConfigChoices', () => {
    it('should build config choices from combinations and transports', () => {
      const combinations: Combination[] = [
        {
          name: 'oauth',
          envKeys: ['AUTH_MODE'],
          argNames: [],
          defaults: {},
          argDefaults: {},
          dimensionValues: { AUTH_MODE: 'oauth' },
        },
        {
          name: 'dcr',
          envKeys: ['AUTH_MODE'],
          argNames: [],
          defaults: {},
          argDefaults: {},
          dimensionValues: { AUTH_MODE: 'dcr' },
        },
      ];

      const transports = ['stdio', 'http'];
      const choices = createConfigChoices(combinations, transports);

      assert.strictEqual(choices.length, 4, 'Should have 2 combinations × 2 transports = 4 choices');
    });

    it('should create correct labels for each choice', () => {
      const combinations: Combination[] = [
        {
          name: 'loopback',
          envKeys: ['AUTH_MODE'],
          argNames: [],
          defaults: {},
          argDefaults: {},
          dimensionValues: { AUTH_MODE: 'loopback' },
        },
      ];

      const transports = ['stdio', 'http'];
      const choices = createConfigChoices(combinations, transports);

      assert.strictEqual(choices[0]?.label, 'loopback (stdio)');
      assert.strictEqual(choices[1]?.label, 'loopback (http)');
    });

    it('should map http transport to streamable-http in choice object', () => {
      const combinations: Combination[] = [
        {
          name: 'test',
          envKeys: [],
          argNames: [],
          defaults: {},
          argDefaults: {},
          dimensionValues: {},
        },
      ];

      const transports = ['http'];
      const choices = createConfigChoices(combinations, transports);

      assert.strictEqual(choices[0]?.transport, 'streamable-http');
      assert.strictEqual(choices[0]?.label, 'test (http)'); // Label keeps user-facing name
    });

    it('should preserve combination reference in each choice', () => {
      const combination: Combination = {
        name: 'original',
        envKeys: ['ENV1'],
        argNames: [],
        defaults: { DEFAULT_KEY: 'default-value' },
        argDefaults: {},
        dimensionValues: { ENV1: 'value1' },
      };

      const choices = createConfigChoices([combination], ['stdio']);

      assert.strictEqual(choices[0]?.combination, combination, 'Should preserve combination object reference');
    });

    it('should handle single transport', () => {
      const combinations: Combination[] = [
        { name: 'a', envKeys: [], argNames: [], defaults: {}, argDefaults: {}, dimensionValues: {} },
        { name: 'b', envKeys: [], argNames: [], defaults: {}, argDefaults: {}, dimensionValues: {} },
      ];

      const choices = createConfigChoices(combinations, ['stdio']);

      assert.strictEqual(choices.length, 2);
      assert.ok(choices.every((c) => c.transport === 'stdio'));
    });

    it('should handle empty combinations array', () => {
      const choices = createConfigChoices([], ['stdio', 'http']);
      assert.deepStrictEqual(choices, []);
    });

    it('should handle empty transports array', () => {
      const combinations: Combination[] = [{ name: 'test', envKeys: [], argNames: [], defaults: {}, argDefaults: {}, dimensionValues: {} }];

      const choices = createConfigChoices(combinations, []);
      assert.deepStrictEqual(choices, []);
    });

    it('should accept streamable-http directly as transport', () => {
      const combinations: Combination[] = [{ name: 'test', envKeys: [], argNames: [], defaults: {}, argDefaults: {}, dimensionValues: {} }];

      const choices = createConfigChoices(combinations, ['streamable-http']);

      assert.strictEqual(choices[0]?.transport, 'streamable-http');
      assert.strictEqual(choices[0]?.label, 'test (streamable-http)');
    });
  });

  describe('filterConfigChoices', () => {
    const testCombinations: Combination[] = [
      { name: 'oauth', envKeys: ['AUTH_MODE'], argNames: [], defaults: {}, argDefaults: {}, dimensionValues: { AUTH_MODE: 'oauth' } },
      { name: 'dcr', envKeys: ['AUTH_MODE'], argNames: [], defaults: {}, argDefaults: {}, dimensionValues: { AUTH_MODE: 'dcr' } },
    ];

    it('should filter choices by selected labels', () => {
      const allChoices = createConfigChoices(testCombinations, ['stdio', 'http']);
      const selectedLabels = ['oauth (stdio)', 'dcr (http)'];

      const filtered = filterConfigChoices(allChoices, selectedLabels);

      assert.strictEqual(filtered.length, 2);
      assert.ok(filtered.some((c) => c.label === 'oauth (stdio)'));
      assert.ok(filtered.some((c) => c.label === 'dcr (http)'));
    });

    it('should return empty array when no labels match', () => {
      const allChoices = createConfigChoices(testCombinations, ['stdio']);
      const selectedLabels = ['nonexistent (http)'];

      const filtered = filterConfigChoices(allChoices, selectedLabels);

      assert.deepStrictEqual(filtered, []);
    });

    it('should return all choices when all labels selected', () => {
      const allChoices = createConfigChoices(testCombinations, ['stdio', 'http']);
      const selectedLabels = allChoices.map((c) => c.label);

      const filtered = filterConfigChoices(allChoices, selectedLabels);

      assert.deepStrictEqual(filtered, allChoices);
    });

    it('should handle empty selections', () => {
      const allChoices = createConfigChoices(testCombinations, ['stdio']);

      const filtered = filterConfigChoices(allChoices, []);

      assert.deepStrictEqual(filtered, []);
    });

    it('should handle empty choices', () => {
      const filtered = filterConfigChoices([], ['some (label)']);

      assert.deepStrictEqual(filtered, []);
    });

    it('should maintain order of original choices', () => {
      const allChoices = createConfigChoices(testCombinations, ['stdio', 'http']);
      // Select in reverse order
      const selectedLabels = ['dcr (http)', 'oauth (stdio)', 'oauth (http)'];

      const filtered = filterConfigChoices(allChoices, selectedLabels);

      // Should maintain original order from allChoices, not selectedLabels
      assert.strictEqual(filtered[0]?.label, 'oauth (stdio)');
      assert.strictEqual(filtered[1]?.label, 'oauth (http)');
      assert.strictEqual(filtered[2]?.label, 'dcr (http)');
    });

    it('should preserve combination and transport properties', () => {
      const allChoices = createConfigChoices(testCombinations, ['http']);
      const filtered = filterConfigChoices(allChoices, ['oauth (http)']);

      assert.strictEqual(filtered.length, 1);
      const choice = filtered[0];
      assert.ok(choice);
      assert.strictEqual(choice.combination.name, 'oauth');
      assert.strictEqual(choice.transport, 'streamable-http');
      assert.strictEqual(choice.label, 'oauth (http)');
    });
  });

  describe('generateConditionalCombinations', () => {
    it('should generate combinations for primary dimensions only when no conditionals', () => {
      const envVars = [{ name: 'AUTH_MODE', choices: ['loopback-oauth', 'service-account'] }];

      const combinations = generateConditionalCombinations(envVars);

      assert.strictEqual(combinations.length, 2);
      assert.ok(combinations.some((c) => c.dimensionValues.AUTH_MODE === 'loopback-oauth'));
      assert.ok(combinations.some((c) => c.dimensionValues.AUTH_MODE === 'service-account'));
    });

    it('should include conditional dimensions only when dependsOn is satisfied', () => {
      const envVars = [
        { name: 'AUTH_MODE', choices: ['loopback-oauth', 'dcr'] },
        { name: 'DCR_MODE', choices: ['self-hosted', 'external'], dependsOn: { AUTH_MODE: ['dcr'] } },
      ];

      const combinations = generateConditionalCombinations(envVars);

      // loopback-oauth: 1 combination (no DCR_MODE)
      // dcr: 2 combinations (self-hosted, external)
      // Total: 3 combinations
      assert.strictEqual(combinations.length, 3);

      // loopback-oauth should NOT have DCR_MODE
      const loopbackCombinations = combinations.filter((c) => c.dimensionValues.AUTH_MODE === 'loopback-oauth');
      assert.strictEqual(loopbackCombinations.length, 1);
      assert.strictEqual(loopbackCombinations[0]?.dimensionValues.DCR_MODE, undefined);
      assert.ok(!loopbackCombinations[0]?.envKeys.includes('DCR_MODE'));

      // dcr should have DCR_MODE combinations
      const dcrCombinations = combinations.filter((c) => c.dimensionValues.AUTH_MODE === 'dcr');
      assert.strictEqual(dcrCombinations.length, 2);
      assert.ok(dcrCombinations.some((c) => c.dimensionValues.DCR_MODE === 'self-hosted'));
      assert.ok(dcrCombinations.some((c) => c.dimensionValues.DCR_MODE === 'external'));
      assert.ok(dcrCombinations.every((c) => c.envKeys.includes('DCR_MODE')));
    });

    it('should handle nested dependsOn (DCR_VERIFY_URL depends on AUTH_MODE=dcr AND DCR_MODE=external)', () => {
      const envVars = [
        { name: 'AUTH_MODE', choices: ['loopback-oauth', 'dcr'] },
        { name: 'DCR_MODE', choices: ['self-hosted', 'external'], dependsOn: { AUTH_MODE: ['dcr'] } },
      ];

      const combinations = generateConditionalCombinations(envVars);

      // Find dcr+external combination
      const dcrExternal = combinations.find((c) => c.dimensionValues.AUTH_MODE === 'dcr' && c.dimensionValues.DCR_MODE === 'external');
      assert.ok(dcrExternal, 'Should have dcr+external combination');
      assert.deepStrictEqual(dcrExternal.envKeys, ['AUTH_MODE', 'DCR_MODE']);

      // Find dcr+self-hosted combination
      const dcrSelfHosted = combinations.find((c) => c.dimensionValues.AUTH_MODE === 'dcr' && c.dimensionValues.DCR_MODE === 'self-hosted');
      assert.ok(dcrSelfHosted, 'Should have dcr+self-hosted combination');
    });

    it('should generate combination names correctly', () => {
      const envVars = [
        { name: 'AUTH_MODE', choices: ['loopback-oauth', 'dcr'] },
        { name: 'DCR_MODE', choices: ['self-hosted'], dependsOn: { AUTH_MODE: ['dcr'] } },
      ];

      const combinations = generateConditionalCombinations(envVars);

      // loopback-oauth combination name should only have AUTH_MODE
      const loopback = combinations.find((c) => c.dimensionValues.AUTH_MODE === 'loopback-oauth');
      assert.ok(loopback);
      assert.strictEqual(loopback.name, 'auth_mode-loopback-oauth');

      // dcr combination: DCR_MODE has only one choice so it's omitted from name
      const dcr = combinations.find((c) => c.dimensionValues.AUTH_MODE === 'dcr');
      assert.ok(dcr);
      assert.strictEqual(dcr.name, 'auth_mode-dcr'); // DCR_MODE omitted because it has only one choice
    });

    it('should include conditional dimension in name when it has multiple choices', () => {
      const envVars = [
        { name: 'AUTH_MODE', choices: ['loopback-oauth', 'dcr'] },
        { name: 'DCR_MODE', choices: ['self-hosted', 'external'], dependsOn: { AUTH_MODE: ['dcr'] } },
      ];

      const combinations = generateConditionalCombinations(envVars);

      // dcr + self-hosted combination should include DCR_MODE in name (multiple choices)
      const dcrSelfHosted = combinations.find((c) => c.dimensionValues.AUTH_MODE === 'dcr' && c.dimensionValues.DCR_MODE === 'self-hosted');
      assert.ok(dcrSelfHosted);
      assert.strictEqual(dcrSelfHosted.name, 'auth_mode-dcr_dcr_mode-self-hosted');

      // dcr + external combination should include DCR_MODE in name
      const dcrExternal = combinations.find((c) => c.dimensionValues.AUTH_MODE === 'dcr' && c.dimensionValues.DCR_MODE === 'external');
      assert.ok(dcrExternal);
      assert.strictEqual(dcrExternal.name, 'auth_mode-dcr_dcr_mode-external');
    });

    it('should return minimal combination when no primary dimensions', () => {
      const envVars: Array<{ name: string; choices: string[]; dependsOn?: Record<string, string[]> }> = [];

      const combinations = generateConditionalCombinations(envVars);

      assert.strictEqual(combinations.length, 1);
      assert.strictEqual(combinations[0]?.name, 'minimal');
      assert.deepStrictEqual(combinations[0]?.envKeys, []);
      assert.deepStrictEqual(combinations[0]?.dimensionValues, {});
    });

    it('should handle multiple conditional dimensions with same dependsOn', () => {
      const envVars = [
        { name: 'AUTH_MODE', choices: ['loopback-oauth', 'dcr'] },
        { name: 'DCR_MODE', choices: ['self-hosted', 'external'], dependsOn: { AUTH_MODE: ['dcr'] } },
        { name: 'DCR_OPTION', choices: ['option1', 'option2'], dependsOn: { AUTH_MODE: ['dcr'] } },
      ];

      const combinations = generateConditionalCombinations(envVars);

      // loopback-oauth: 1 combination
      // dcr: 2 DCR_MODE × 2 DCR_OPTION = 4 combinations
      // Total: 5 combinations
      assert.strictEqual(combinations.length, 5);

      // loopback-oauth should not have any DCR_* in dimensionValues
      const loopback = combinations.filter((c) => c.dimensionValues.AUTH_MODE === 'loopback-oauth');
      assert.strictEqual(loopback.length, 1);
      assert.strictEqual(loopback[0]?.dimensionValues.DCR_MODE, undefined);
      assert.strictEqual(loopback[0]?.dimensionValues.DCR_OPTION, undefined);
    });
  });

  describe('generateConfig with dependsOn filtering', () => {
    it('should NOT include DCR_MODE in env when AUTH_MODE is loopback-oauth', async () => {
      const outputDir = path.join(tmpDir, 'depends-on-test-1');
      fs.mkdirSync(outputDir, { recursive: true });

      // This simulates a loopback-oauth combination where DCR_MODE should be excluded
      const combination: Combination = {
        name: 'auth_mode-loopback-oauth',
        envKeys: ['AUTH_MODE'], // Only AUTH_MODE, NOT DCR_MODE
        argNames: [],
        defaults: { LOG_LEVEL: 'info' }, // Some defaults
        argDefaults: {},
        dimensionValues: { AUTH_MODE: 'loopback-oauth' },
      };

      const mockMetadata: ServerMetadata = {
        name: 'test-server',
        description: 'Test',
        version: '1.0.0',
        title: 'Test',
        packages: [
          {
            registryType: 'npm',
            identifier: '@test/server',
            transport: { type: 'stdio' },
            environmentVariables: [
              { name: 'AUTH_MODE', description: 'Auth mode', isSecret: false, choices: ['loopback-oauth', 'dcr'] },
              { name: 'DCR_MODE', description: 'DCR mode', isSecret: false, choices: ['self-hosted', 'external'], default: 'self-hosted', dependsOn: { AUTH_MODE: ['dcr'] } },
              { name: 'LOG_LEVEL', description: 'Log level', isSecret: false, default: 'info' },
            ],
            packageArguments: [],
          },
        ],
      };

      const mockReader: Pick<MetadataReader, 'getPackageForTransport'> = {
        getPackageForTransport: (metadata: ServerMetadata, transport: string) => {
          return metadata.packages.find((p) => p.transport.type === transport);
        },
      };

      await generateConfigFile(
        {
          serverName: 'test',
          combination,
          transport: 'stdio',
          outputDir,
          packageName: '@test/server',
          metadata: mockMetadata,
          metadataReader: mockReader,
          quick: true, // Matrix mode uses quick
        },
        mockPromptForEnvVars
      );

      const configPath = path.join(outputDir, '.mcp.auth_mode-loopback-oauth-stdio.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      // DCR_MODE should NOT be in the config
      assert.strictEqual(config.mcpServers.test.env.DCR_MODE, undefined, 'DCR_MODE should NOT be in env for loopback-oauth');
      // AUTH_MODE should be present
      assert.strictEqual(config.mcpServers.test.env.AUTH_MODE, 'loopback-oauth');
      // LOG_LEVEL should be present from defaults
      assert.strictEqual(config.mcpServers.test.env.LOG_LEVEL, 'info');
    });

    it('should include DCR_MODE in env when AUTH_MODE is dcr', async () => {
      const outputDir = path.join(tmpDir, 'depends-on-test-2');
      fs.mkdirSync(outputDir, { recursive: true });

      // This simulates a dcr combination where DCR_MODE should be included
      const combination: Combination = {
        name: 'auth_mode-dcr_dcr_mode-self-hosted',
        envKeys: ['AUTH_MODE', 'DCR_MODE'], // Both included
        argNames: [],
        defaults: { LOG_LEVEL: 'info' },
        argDefaults: {},
        dimensionValues: { AUTH_MODE: 'dcr', DCR_MODE: 'self-hosted' },
      };

      const mockMetadata: ServerMetadata = {
        name: 'test-server',
        description: 'Test',
        version: '1.0.0',
        title: 'Test',
        packages: [
          {
            registryType: 'npm',
            identifier: '@test/server',
            transport: { type: 'stdio' },
            environmentVariables: [
              { name: 'AUTH_MODE', description: 'Auth mode', isSecret: false, choices: ['loopback-oauth', 'dcr'] },
              { name: 'DCR_MODE', description: 'DCR mode', isSecret: false, choices: ['self-hosted', 'external'], default: 'self-hosted', dependsOn: { AUTH_MODE: ['dcr'] } },
              { name: 'LOG_LEVEL', description: 'Log level', isSecret: false, default: 'info' },
            ],
            packageArguments: [],
          },
        ],
      };

      const mockReader: Pick<MetadataReader, 'getPackageForTransport'> = {
        getPackageForTransport: (metadata: ServerMetadata, transport: string) => {
          return metadata.packages.find((p) => p.transport.type === transport);
        },
      };

      await generateConfigFile(
        {
          serverName: 'test',
          combination,
          transport: 'stdio',
          outputDir,
          packageName: '@test/server',
          metadata: mockMetadata,
          metadataReader: mockReader,
          quick: true,
        },
        mockPromptForEnvVars
      );

      const configPath = path.join(outputDir, '.mcp.auth_mode-dcr_dcr_mode-self-hosted-stdio.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      // DCR_MODE SHOULD be in the config
      assert.strictEqual(config.mcpServers.test.env.DCR_MODE, 'self-hosted', 'DCR_MODE should be in env for dcr mode');
      assert.strictEqual(config.mcpServers.test.env.AUTH_MODE, 'dcr');
    });

    it('should filter defaults with dependsOn in quick mode', async () => {
      const outputDir = path.join(tmpDir, 'depends-on-defaults-test');
      fs.mkdirSync(outputDir, { recursive: true });

      // Combination where DCR_STORE_URI has a default but depends on AUTH_MODE=dcr
      const combination: Combination = {
        name: 'auth_mode-loopback-oauth',
        envKeys: ['AUTH_MODE'],
        argNames: [],
        defaults: {
          LOG_LEVEL: 'info',
          DCR_STORE_URI: 'file://~/.mcp/dcr.json', // Has default but depends on AUTH_MODE=dcr
        },
        argDefaults: {},
        dimensionValues: { AUTH_MODE: 'loopback-oauth' },
      };

      const mockMetadata: ServerMetadata = {
        name: 'test-server',
        description: 'Test',
        version: '1.0.0',
        title: 'Test',
        packages: [
          {
            registryType: 'npm',
            identifier: '@test/server',
            transport: { type: 'stdio' },
            environmentVariables: [
              { name: 'AUTH_MODE', description: 'Auth mode', isSecret: false, choices: ['loopback-oauth', 'dcr'] },
              { name: 'LOG_LEVEL', description: 'Log level', isSecret: false, default: 'info' },
              { name: 'DCR_STORE_URI', description: 'DCR store', isSecret: false, default: 'file://~/.mcp/dcr.json', dependsOn: { AUTH_MODE: ['dcr'] } },
            ],
            packageArguments: [],
          },
        ],
      };

      const mockReader: Pick<MetadataReader, 'getPackageForTransport'> = {
        getPackageForTransport: (metadata: ServerMetadata, transport: string) => {
          return metadata.packages.find((p) => p.transport.type === transport);
        },
      };

      await generateConfigFile(
        {
          serverName: 'test',
          combination,
          transport: 'stdio',
          outputDir,
          packageName: '@test/server',
          metadata: mockMetadata,
          metadataReader: mockReader,
          quick: true,
        },
        mockPromptForEnvVars
      );

      const configPath = path.join(outputDir, '.mcp.auth_mode-loopback-oauth-stdio.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      // DCR_STORE_URI should be filtered out because AUTH_MODE is loopback-oauth
      assert.strictEqual(config.mcpServers.test.env.DCR_STORE_URI, undefined, 'DCR_STORE_URI should be filtered out');
      // LOG_LEVEL should still be present (no dependsOn)
      assert.strictEqual(config.mcpServers.test.env.LOG_LEVEL, 'info');
    });

    it('should generate HTTP config with proper structure in matrix mode', async () => {
      const outputDir = path.join(tmpDir, 'http-matrix-test');
      fs.mkdirSync(outputDir, { recursive: true });

      const combination: Combination = {
        name: 'auth_mode-loopback-oauth',
        envKeys: ['AUTH_MODE'],
        argNames: [],
        defaults: {},
        argDefaults: {},
        dimensionValues: { AUTH_MODE: 'loopback-oauth' },
      };

      const mockMetadata: ServerMetadata = {
        name: 'test-server',
        description: 'Test',
        version: '1.0.0',
        title: 'Test',
        packages: [
          {
            registryType: 'npm',
            identifier: '@test/server',
            transport: { type: 'streamable-http', url: 'http://localhost:3000/mcp' },
            environmentVariables: [{ name: 'AUTH_MODE', description: 'Auth mode', isSecret: false, choices: ['loopback-oauth', 'dcr'] }],
            packageArguments: [],
          },
        ],
      };

      const mockReader: Pick<MetadataReader, 'getPackageForTransport'> = {
        getPackageForTransport: (metadata: ServerMetadata, transport: string) => {
          return metadata.packages.find((p) => p.transport.type === transport);
        },
      };

      await generateConfigFile(
        {
          serverName: 'test',
          combination,
          transport: 'http',
          outputDir,
          packageName: '@test/server',
          metadata: mockMetadata,
          metadataReader: mockReader,
          httpHost: 'localhost',
          httpPort: 3000,
          quick: true,
        },
        mockPromptForEnvVars
      );

      const configPath = path.join(outputDir, '.mcp.auth_mode-loopback-oauth-http.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      // Verify HTTP config has proper structure
      assert.strictEqual(config.mcpServers.test.type, 'http', 'Should have type: http');
      assert.strictEqual(config.mcpServers.test.url, 'http://localhost:3000/mcp', 'Should have correct URL');
      assert.ok(config.mcpServers.test.start, 'Should have start block');
      assert.strictEqual(config.mcpServers.test.start.command, 'npx');
      assert.ok(config.mcpServers.test.start.args.includes('--port'));
      assert.ok(config.mcpServers.test.start.args.includes('3000'));
    });

    it('should generate HTTP config with streamable-http transport (real flow)', async () => {
      // In the actual code flow, createConfigChoices maps 'http' → 'http'
      // This test verifies the fix that checks for both 'http' and 'http'
      const outputDir = path.join(tmpDir, 'streamable-http-test');
      fs.mkdirSync(outputDir, { recursive: true });

      const combination: Combination = {
        name: 'auth_mode-loopback-oauth',
        envKeys: ['AUTH_MODE'],
        argNames: [],
        defaults: {},
        argDefaults: {},
        dimensionValues: { AUTH_MODE: 'loopback-oauth' },
      };

      const mockMetadata: ServerMetadata = {
        name: 'test-server',
        description: 'Test',
        version: '1.0.0',
        title: 'Test',
        packages: [
          {
            registryType: 'npm',
            identifier: '@test/server',
            transport: { type: 'streamable-http', url: 'http://localhost:6001/mcp' },
            environmentVariables: [{ name: 'AUTH_MODE', description: 'Auth mode', isSecret: false, choices: ['loopback-oauth', 'dcr'] }],
            packageArguments: [],
          },
        ],
      };

      const mockReader: Pick<MetadataReader, 'getPackageForTransport'> = {
        getPackageForTransport: (metadata: ServerMetadata, transport: string) => {
          return metadata.packages.find((p) => p.transport.type === transport);
        },
      };

      // Use 'http' as the transport (this is what createConfigChoices returns)
      await generateConfigFile(
        {
          serverName: 'test',
          combination,
          transport: 'http',
          outputDir,
          packageName: '@test/server',
          metadata: mockMetadata,
          metadataReader: mockReader,
          httpHost: 'localhost',
          httpPort: 6001,
          quick: true,
        },
        mockPromptForEnvVars
      );

      const configPath = path.join(outputDir, '.mcp.auth_mode-loopback-oauth-http.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      // Verify HTTP config has proper structure
      assert.strictEqual(config.mcpServers.test.type, 'http', 'Should have type: http');
      assert.strictEqual(config.mcpServers.test.url, 'http://localhost:6001/mcp', 'Should have correct URL');
      assert.ok(config.mcpServers.test.start, 'Should have start block');
      assert.strictEqual(config.mcpServers.test.start.command, 'npx');
      assert.ok(config.mcpServers.test.start.args.includes('--port'), 'Should include --port arg');
      assert.ok(config.mcpServers.test.start.args.includes('6001'), 'Should include port value');
    });
  });
});
