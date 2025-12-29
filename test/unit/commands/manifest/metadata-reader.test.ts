import { MetadataReader } from '@mcp-z/cli';
import assert from 'assert';
import * as path from 'path';

describe('MetadataReader', () => {
  const fixturesPath = path.join(process.cwd(), 'test/fixtures/metadata');
  const reader = new MetadataReader({
    monorepoPath: fixturesPath,
    skipSchemaValidation: true,
  });

  describe('readServerMetadata', () => {
    it('should read metadata for echo-server from test fixtures', async () => {
      const metadata = await reader.readServerMetadata('echo-server');

      assert.ok(metadata, 'Metadata should be returned');
      assert.ok(metadata.name, 'Should have name');
      assert.ok(metadata.packages, 'Should have packages array');
      assert.ok(metadata.packages.length > 0, 'Should have at least one package');
      assert.ok(metadata.description, 'Should have description');
      assert.ok(metadata.version, 'Should have version');
    });

    it('should read metadata via discovery for short names', async () => {
      // Short names are resolved via discoverInstalledServers
      const servers = await reader.discoverInstalledServers();
      const echoServer = servers.find((s) => s.shortName === 'echo-server');

      assert.ok(echoServer, 'Should discover echo-server');

      // Reading by short name should work via discovery
      const metadata = await reader.readServerMetadata('echo-server');
      assert.ok(metadata, 'Metadata should be returned');
      assert.ok(metadata.name, 'Should have name');
    });

    it('should read metadata for minimal-server', async () => {
      const metadata = await reader.readServerMetadata('minimal-server');

      assert.ok(metadata, 'Metadata should be returned');
      assert.ok(metadata.name, 'Should have name');
      assert.ok(metadata.packages.length > 0, 'Should have at least one package');
    });

    it('should throw error for non-existent server', async () => {
      await assert.rejects(
        async () => {
          await reader.readServerMetadata('non-existent-server');
        },
        {
          message: /Server 'non-existent-server' not found/,
        },
        'Should throw error for non-existent server'
      );
    });
  });

  describe('getPackageForTransport', () => {
    it('should get stdio package for echo-server', async () => {
      const metadata = await reader.readServerMetadata('echo-server');
      const pkg = reader.getPackageForTransport(metadata, 'stdio');

      assert.ok(pkg, 'Package should be found');
      assert.strictEqual(pkg.transport.type, 'stdio', 'Transport type should be stdio');
      assert.ok(pkg.identifier, 'Package should have identifier');
      assert.ok(pkg.environmentVariables, 'Package should have environmentVariables');
      assert.ok(pkg.packageArguments, 'Package should have packageArguments');
    });

    it('should get stdio package for minimal-server', async () => {
      const metadata = await reader.readServerMetadata('minimal-server');
      const pkg = reader.getPackageForTransport(metadata, 'stdio');

      assert.ok(pkg, 'Package should be found');
      assert.strictEqual(pkg.transport.type, 'stdio', 'Transport type should be stdio');
      assert.ok(pkg.identifier, 'Package should have identifier');
    });

    it('should return undefined for non-existent transport', async () => {
      const metadata = await reader.readServerMetadata('echo-server');
      const pkg = reader.getPackageForTransport(metadata, 'streamable-http' as never);

      assert.strictEqual(pkg, undefined, 'Should return undefined for non-existent transport');
    });
  });

  describe('discoverInstalledServers', () => {
    it('should discover installed servers from test fixtures', async () => {
      const servers = await reader.discoverInstalledServers();

      assert.ok(servers, 'Servers array should be returned');
      assert.ok(Array.isArray(servers), 'Should return an array');
      assert.ok(servers.length > 0, 'Should find at least one server');

      // Should find test servers in fixtures by shortName
      const shortNames = servers.map((s) => s.shortName);
      assert.ok(shortNames.includes('echo-server'), 'Should find echo-server');
      assert.ok(shortNames.includes('minimal-server'), 'Should find minimal-server');
      assert.ok(shortNames.includes('partial-server'), 'Should find partial-server');
    });

    it('should return servers with correct structure', async () => {
      const servers = await reader.discoverInstalledServers();
      assert.ok(servers.length > 0, 'Should have servers');

      const server = servers[0];
      assert.ok(server, 'First server should exist');
      assert.ok(server.shortName, 'Should have shortName');
      assert.ok(server.packageName, 'Should have packageName');
      assert.ok(server.serverJsonPath, 'Should have serverJsonPath');
    });

    it('should return servers in sorted order', async () => {
      const servers = await reader.discoverInstalledServers();

      const shortNames = servers.map((s) => s.shortName);
      const sorted = [...shortNames].sort();
      assert.deepStrictEqual(shortNames, sorted, 'Servers should be sorted alphabetically by shortName');
    });

    it('should not include duplicate servers', async () => {
      const servers = await reader.discoverInstalledServers();

      const shortNames = servers.map((s) => s.shortName);
      const unique = [...new Set(shortNames)];
      assert.deepStrictEqual(shortNames, unique, 'Should not have duplicate shortNames');
    });
  });

  describe('metadata structure validation', () => {
    it('should have valid package structure for echo-server', async () => {
      const metadata = await reader.readServerMetadata('echo-server');
      const pkg = reader.getPackageForTransport(metadata, 'stdio');

      assert.ok(pkg, 'Package should exist');

      // Validate package structure
      assert.ok(pkg.registryType, 'Should have registryType');
      assert.ok(pkg.identifier, 'Should have identifier');
      assert.ok(pkg.transport, 'Should have transport');
      assert.ok(Array.isArray(pkg.environmentVariables), 'environmentVariables should be array');
      assert.ok(Array.isArray(pkg.packageArguments), 'packageArguments should be array');

      // Validate environment variables structure
      if (pkg.environmentVariables.length > 0) {
        const envVar = pkg.environmentVariables[0];
        assert.ok(envVar, 'First env var should exist');
        assert.ok(envVar.name, 'Env var should have name');
        assert.ok(envVar.description, 'Env var should have description');
        assert.ok(typeof envVar.isSecret === 'boolean', 'Env var should have isSecret boolean');
      }

      // Validate package arguments structure
      if (pkg.packageArguments.length > 0) {
        const arg = pkg.packageArguments[0];
        assert.ok(arg, 'First arg should exist');
        assert.ok(arg.name, 'Arg should have name');
        assert.strictEqual(arg.type, 'named', 'Arg type should be named');
      }
    });

    it('should have valid environment variable choices for servers that use them', async () => {
      const metadata = await reader.readServerMetadata('partial-server');
      const pkg = reader.getPackageForTransport(metadata, 'stdio');

      assert.ok(pkg, 'Package should exist');

      // Find env vars with choices
      const envVarsWithChoices = pkg.environmentVariables.filter((v) => v.choices && v.choices.length > 0);

      assert.ok(envVarsWithChoices.length > 0, 'Should have env vars with choices');

      for (const envVar of envVarsWithChoices) {
        assert.ok(Array.isArray(envVar.choices), 'Choices should be array');
        assert.ok(envVar.choices && envVar.choices.length > 0, 'Choices should not be empty');
        assert.ok(envVar.choices && envVar.choices.every((c) => typeof c === 'string'), 'All choices should be strings');
      }
    });
  });
});
