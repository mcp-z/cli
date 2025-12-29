/**
 * find-config.ts
 *
 * Find .mcp.json config file by searching up the directory tree.
 * Searches from cwd up to home directory (like Claude Code).
 */

import * as fs from 'fs';
import moduleRoot from 'module-root-sync';
import * as os from 'os';
import * as path from 'path';

const CONFIG_NAME = '.mcp.json';

/**
 * Find .mcp.json by searching up directory tree from cwd to home directory.
 *
 * @param explicitPath - If provided, validates and returns this path (for --config flag)
 * @returns The resolved path to the config file
 * @throws Error if config file not found
 */
export function findConfigPath(explicitPath?: string): string {
  // If explicit path provided, validate it exists
  if (explicitPath) {
    const resolvedPath = path.resolve(explicitPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Config file not found: ${resolvedPath}`);
    }
    return resolvedPath;
  }

  const cwd = process.cwd();
  const homeDir = os.homedir();

  // Use module-root-sync with custom file name to search up
  try {
    const configDir = moduleRoot(cwd, { name: CONFIG_NAME });
    const configPath = path.join(configDir, CONFIG_NAME);

    // Ensure we haven't gone above home directory
    if (!configPath.startsWith(homeDir)) {
      throw new Error(`Config file not found in directory tree (searched from ${cwd} to ${homeDir})`);
    }

    return configPath;
  } catch (_) {
    throw new Error(`Config file not found: ${CONFIG_NAME}\n\nSearched from ${cwd} up to ${homeDir}`);
  }
}
