import { Ajv, type ErrorObject } from 'ajv';
import * as fs from 'fs';
import { createRequire } from 'module';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM-compatible __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import ajv-formats (CommonJS module - use createRequire for ESM compatibility)
const require = createRequire(import.meta.url);
const addFormats = require('ajv-formats');

export const SCHEMA_URL = 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';

let schemaCache: object | null = null;

/**
 * Get MCP server.json schema (fetches once, then caches)
 *
 * Strategy:
 * 1. Return cached schema if available
 * 2. Try fetching latest schema from URL
 * 3. Fall back to bundled schema if network fails
 */
export async function getSchema(): Promise<object> {
  // Return cached schema
  if (schemaCache) {
    return schemaCache;
  }

  try {
    // Try fetching latest schema
    const response = await fetch(SCHEMA_URL);
    if (response.ok) {
      schemaCache = (await response.json()) as object;
      return schemaCache;
    }
  } catch {
    // Network error - fall through to bundled version
  }

  // Fallback to bundled schema
  const bundledPath = path.join(__dirname, '../../schemas/server.schema.json');
  if (!fs.existsSync(bundledPath)) {
    throw new Error('Failed to fetch MCP schema from URL and no bundled schema found. ' + 'Check network connection or report this as a bug.');
  }

  schemaCache = JSON.parse(fs.readFileSync(bundledPath, 'utf8')) as object;
  return schemaCache;
}

/**
 * Validate server.json against MCP schema
 *
 * @param serverJson - Parsed server.json content to validate
 * @param serverName - Server name for error messages
 * @throws Error with detailed validation messages if invalid
 */
export async function validateSchema(serverJson: unknown, serverName: string): Promise<void> {
  const schema = await getSchema();

  const ajv = new Ajv({
    allErrors: true,
    verbose: true,
    strictSchema: false, // Allow non-standard keywords like "example", "choices"
  });

  // Add format validators (uri, email, etc.) to silence warnings
  addFormats(ajv);

  const validate = ajv.compile(schema);
  const valid = validate(serverJson);

  if (!valid) {
    const errors = validate.errors?.map((e: ErrorObject) => `  - ${e.instancePath || '(root)'} ${e.message}`).join('\n') || 'Unknown validation error';

    throw new Error(`Invalid server.json for '${serverName}':\n${errors}\n\nThe server.json file does not conform to the MCP specification.\nSee: https://modelcontextprotocol.io/specification/server\n\nTo fix: Update the server.json file to match the schema requirements above.`);
  }
}
