import * as fs from 'fs';
import Module from 'module';
import * as path from 'path';
import { validateSchema } from '../../lib/json-schema.ts';

export interface ServerMetadata {
  name: string;
  description: string;
  version: string;
  title: string;
  packages: PackageConfig[];
}

export interface PackageConfig {
  registryType: string;
  identifier: string;
  transport: {
    type: 'stdio' | 'streamable-http';
    url?: string;
  };
  runtimeHint?: string;
  runtimeArguments?: CliArgMetadata[];
  environmentVariables: EnvVarMetadata[];
  packageArguments: CliArgMetadata[];
}

export interface EnvVarMetadata {
  name: string;
  value?: string;
  default?: string; // Default value (MCP schema standard field)
  description: string;
  placeholder?: string;
  choices?: string[];
  isRequired?: boolean;
  isSecret: boolean;
  isMandatoryForMatrix?: boolean; // Include in test matrix? (default: true for vars with choices)
  dependsOn?: Record<string, string[]>; // Conditional: only prompt when dependency has specific value(s)
}

export interface CliArgMetadata {
  type: 'named';
  name: string;
  value?: string;
  description?: string;
  choices?: string[];
}

export interface MetadataReaderOptions {
  monorepoPath?: string;
  nodeModulesPath?: string;
  moduleResolutionPaths?: string[];
  skipSchemaValidation?: boolean;
}

// `require` exists in the CJS build only; the ESM build needs one made from its own URL
const _require = typeof require === 'undefined' ? Module.createRequire(import.meta.url) : require;

/** The named server has no server.json installed (as opposed to one that exists but is unreadable or invalid). */
export class ServerNotFoundError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'ServerNotFoundError';
    if (options && 'cause' in options) (this as { cause?: unknown }).cause = options.cause;
  }
}

/** A dangling symlink or an entry removed mid-scan: nothing to read there, so it is skipped. */
function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/** Resolution or read failures that mean the package or its server.json is simply not there. */
function isNotInstalled(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === 'MODULE_NOT_FOUND' || code === 'ENOENT' || code === 'ERR_PACKAGE_PATH_NOT_EXPORTED';
}

export class MetadataReader {
  private readonly options: MetadataReaderOptions;

  constructor(options: MetadataReaderOptions = {}) {
    this.options = options;
  }

  /**
   * Read server.json metadata from local directory or node_modules
   * Validates against MCP schema before returning
   *
   * @param serverName - Can be:
   *   - Full package name: "@org/package-name"
   *   - Short name: "drive" (will search node_modules for packages with server.json)
   */
  async readServerMetadata(serverName: string): Promise<ServerMetadata> {
    let content: string;
    let sourcePath: string;

    // If it's a scoped package name, try to resolve directly
    const resolutionPaths = this.options.moduleResolutionPaths ?? [process.cwd()];

    if (serverName.startsWith('@')) {
      try {
        const packagePath = _require.resolve(`${serverName}/server.json`, {
          paths: resolutionPaths,
        });
        content = fs.readFileSync(packagePath, 'utf8');
        sourcePath = packagePath;
      } catch (error) {
        // Only "not installed / no server.json" means not found; a permissions or other read error must surface
        if (isNotInstalled(error)) {
          throw new ServerNotFoundError(`Server '${serverName}' not found in node_modules`, { cause: error });
        }
        throw error;
      }
    } else {
      // Short name - search for matching package
      const discovered = await this.discoverInstalledServers();
      const match = discovered.find((s) => s.shortName === serverName);

      if (match) {
        content = fs.readFileSync(match.serverJsonPath, 'utf8');
        sourcePath = match.serverJsonPath;
      } else {
        throw new ServerNotFoundError(`Server '${serverName}' not found. Run 'mcpz config list --available' to see installed servers.`);
      }
    }

    const metadata = JSON.parse(content);

    // Validate against MCP schema
    if (!this.options.skipSchemaValidation) {
      try {
        await validateSchema(metadata, serverName);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message}\n\nSource: ${sourcePath}`);
      }
    }

    return metadata;
  }

  /**
   * Get package config for specific transport type
   */
  getPackageForTransport(metadata: ServerMetadata, transport: 'stdio' | 'streamable-http'): PackageConfig | undefined {
    return metadata.packages.find((p) => p.transport.type === transport);
  }

  /**
   * Discover installed servers from:
   * 1. ../servers/ directory (for monorepo development)
   * 2. node_modules (any package with server.json)
   */
  async discoverInstalledServers(): Promise<Array<{ shortName: string; packageName: string; serverJsonPath: string }>> {
    const servers: Array<{ shortName: string; packageName: string; serverJsonPath: string }> = [];
    const seen = new Set<string>();

    const basePath = this.options.moduleResolutionPaths?.[0] ?? process.cwd();

    // Check ../servers/ for monorepo development (packages named server-*)
    const monorepoPath = this.options.monorepoPath ?? path.join(basePath, '..', 'servers');
    if (fs.existsSync(monorepoPath)) {
      const entries = fs.readdirSync(monorepoPath);
      for (const entry of entries) {
        const serverJsonPath = path.join(monorepoPath, entry, 'server.json');
        if (fs.existsSync(serverJsonPath)) {
          // Extract short name (e.g., "gmail" from "mcp-gmail")
          const shortName = entry.startsWith('server-') ? entry.replace('server-', '') : entry;
          if (!seen.has(shortName)) {
            seen.add(shortName);
            servers.push({
              shortName,
              packageName: entry, // Use directory name as package name for monorepo
              serverJsonPath,
            });
          }
        }
      }
    }

    // Check node_modules for any package with server.json
    const nodeModulesPath = this.options.nodeModulesPath ?? path.join(basePath, 'node_modules');
    if (fs.existsSync(nodeModulesPath)) {
      const entries = fs.readdirSync(nodeModulesPath);

      for (const entry of entries) {
        if (entry.startsWith('@')) {
          // Scoped package - check all packages in scope
          const scopePath = path.join(nodeModulesPath, entry);
          let scopedPackages: string[];
          try {
            if (!fs.statSync(scopePath).isDirectory()) continue;
            scopedPackages = fs.readdirSync(scopePath);
          } catch (error) {
            if (isMissing(error)) continue; // dangling scope link
            throw error;
          }
          for (const pkg of scopedPackages) {
            const serverJsonPath = path.join(scopePath, pkg, 'server.json');
            if (fs.existsSync(serverJsonPath)) {
              const shortName = pkg.startsWith('server-') ? pkg.replace('server-', '') : pkg;
              if (!seen.has(shortName)) {
                seen.add(shortName);
                servers.push({
                  shortName,
                  packageName: `${entry}/${pkg}`,
                  serverJsonPath,
                });
              }
            }
          }
        } else {
          // Unscoped package - check for server.json
          const serverJsonPath = path.join(nodeModulesPath, entry, 'server.json');
          if (fs.existsSync(serverJsonPath)) {
            const shortName = entry.startsWith('server-') ? entry.replace('server-', '') : entry;
            if (!seen.has(shortName)) {
              seen.add(shortName);
              servers.push({
                shortName,
                packageName: entry,
                serverJsonPath,
              });
            }
          }
        }
      }
    }

    return servers.sort((a, b) => a.shortName.localeCompare(b.shortName));
  }
}
