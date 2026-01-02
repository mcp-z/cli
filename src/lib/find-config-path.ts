/**
 * find-config-path.ts
 *
 * Find config file by searching up the directory tree.
 * Searches from cwd up to stopDir (default: home directory).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface FindConfigOptions {
  /** Config filename or path (default: ".mcp.json") */
  config?: string;
  /** Directory to start searching from (default: process.cwd()) */
  cwd?: string;
  /** Directory to stop searching at, inclusive (default: os.homedir()) */
  stopDir?: string;
}

/**
 * Find a config file by searching up directory tree from cwd to stopDir.
 *
 * If config includes a path separator or is absolute, it is treated as a path.
 * Otherwise it is treated as a filename and searched upwards.
 *
 * @throws Error if config file not found
 */
export default function findConfigPath(options: FindConfigOptions = {}): string {
  const config = options.config ?? '.mcp.json';
  const cwd = options.cwd ?? process.cwd();
  const stopDir = options.stopDir ?? os.homedir();

  if (isPathLike(config)) {
    const resolved = path.isAbsolute(config) ? config : path.resolve(cwd, config);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Config file not found: ${resolved}`);
    }
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      const candidate = path.join(resolved, '.mcp.json');
      if (!fs.existsSync(candidate)) {
        throw new Error(`Config file not found: ${candidate}`);
      }
      return candidate;
    }
    return resolved;
  }

  const root = path.parse(cwd).root;
  let dir = cwd;

  while (true) {
    const candidate = path.join(dir, config);
    if (fs.existsSync(candidate)) return candidate;

    if (dir === root) break;
    if (isSamePath(dir, stopDir)) break;

    // Stop after checking stopDir if it's an ancestor.
    if (!isWithin(dir, stopDir)) break;

    dir = path.dirname(dir);
  }

  throw new Error(`Config file not found: ${config}\n\nSearched from ${cwd} up to ${stopDir}`);
}

function isPathLike(value: string): boolean {
  return path.isAbsolute(value) || /[\\/]/.test(value);
}

function isWithin(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isSamePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}
