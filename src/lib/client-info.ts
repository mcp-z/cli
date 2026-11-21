import * as fs from 'fs';
import moduleRoot from 'module-root-sync';
import * as path from 'path';
import * as url from 'url';
import { CLIENT_NAME } from '../constants.ts';

const __dirname = path.dirname(typeof __filename !== 'undefined' ? __filename : url.fileURLToPath(import.meta.url));

function readPackageVersion(): string {
  let file = __dirname;
  try {
    file = path.join(moduleRoot(__dirname), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: string };
    if (typeof pkg.version !== 'string') throw new Error('it has no version');
    return pkg.version;
  } catch (error) {
    throw new Error(`Cannot read the cli's version from ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The version `--version` prints: the cli's own, or 'unknown' when its package.json cannot be read. */
export function packageVersion(): string {
  try {
    return readPackageVersion();
  } catch {
    return 'unknown';
  }
}

/** The clientInfo every server connection made by this cli sends; throws when the cli's own version cannot be read. */
export function clientInfo(): { name: string; version: string } {
  return { name: CLIENT_NAME, version: readPackageVersion() };
}
