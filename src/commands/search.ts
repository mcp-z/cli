/**
 * search.ts
 *
 * Search MCP server capabilities (tools, prompts, resources) without loading full schemas.
 * Designed for agent discovery workflows.
 */

import { type CapabilityType, createServerRegistry, type SearchField, type SearchOptions, type SearchResponse, type ServerRegistry } from '@mcp-z/client';
import * as fs from 'fs';
import * as path from 'path';
import findConfigPath from '../lib/find-config-path.ts';

export interface SearchCommandOptions {
  config?: string;
  servers?: string;
  types?: string;
  fields?: string;
  limit?: number;
  threshold?: number;
  json?: boolean;
  attach?: boolean;
}

/**
 * Main search command implementation.
 *
 * @param query - The search query string
 * @param opts - Search options from CLI flags
 *
 * @example
 * // Search for email-related capabilities
 * await searchCommand('send email', {});
 *
 * @example
 * // Search only tools in specific servers
 * await searchCommand('spreadsheet', { types: 'tool', servers: 'sheets,drive' });
 */
export async function searchCommand(query: string, opts: SearchCommandOptions = {}): Promise<void> {
  let registry: ServerRegistry | undefined;

  try {
    const configPath = findConfigPath({ config: opts.config });
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const servers = raw.mcpServers ?? raw.servers ?? raw;
    const configDir = path.dirname(configPath);

    // Parse options
    const searchOptions: SearchOptions = {
      types: parseTypes(opts.types),
      servers: parseServers(opts.servers),
      searchFields: parseFields(opts.fields),
      limit: opts.limit ?? 20,
      threshold: opts.threshold ?? 0,
    };

    // Create registry (spawns stdio servers, registers HTTP servers)
    // In attach mode, don't spawn - just register for connection
    registry = createServerRegistry(servers, {
      cwd: configDir,
      dialects: opts.attach ? [] : ['servers', 'start'], // Empty dialects = no spawning
    });

    // Connect to all servers (or filtered subset)
    const serverNames = searchOptions.servers ?? Object.keys(servers || {});

    for (const serverName of serverNames) {
      try {
        await registry.connect(serverName);
      } catch (error) {
        // Log connection errors but continue with other servers
        if (!opts.json) {
          console.error(`⚠ Failed to connect to ${serverName}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    // Search across connected clients
    const response = await registry.searchCapabilities(query, searchOptions);

    // Output results
    if (opts.json) {
      outputJSON(response);
    } else {
      outputPretty(response);
    }
  } finally {
    // Cleanup - registry.close() handles all clients and servers
    if (registry) {
      try {
        await registry.close();
      } catch (_) {
        // Ignore close errors
      }
    }
  }
}

/**
 * Parse comma-separated types into CapabilityType array
 */
function parseTypes(typesStr?: string): CapabilityType[] | undefined {
  if (!typesStr) return undefined;

  const validTypes: CapabilityType[] = ['tool', 'prompt', 'resource'];
  const parsed = typesStr.split(',').map((t) => t.trim().toLowerCase()) as CapabilityType[];

  const invalid = parsed.filter((t) => !validTypes.includes(t));
  if (invalid.length > 0) {
    throw new Error(`Invalid types: ${invalid.join(', ')}. Valid types: ${validTypes.join(', ')}`);
  }

  return parsed;
}

/**
 * Parse comma-separated server names
 */
function parseServers(serversStr?: string): string[] | undefined {
  if (!serversStr) return undefined;
  return serversStr.split(',').map((s) => s.trim());
}

/**
 * Parse comma-separated search fields
 */
function parseFields(fieldsStr?: string): SearchField[] | undefined {
  if (!fieldsStr) return undefined;

  const validFields: SearchField[] = ['name', 'description', 'schema', 'server'];
  const parsed = fieldsStr.split(',').map((f) => f.trim().toLowerCase()) as SearchField[];

  const invalid = parsed.filter((f) => !validFields.includes(f));
  if (invalid.length > 0) {
    throw new Error(`Invalid fields: ${invalid.join(', ')}. Valid fields: ${validFields.join(', ')}`);
  }

  return parsed;
}

/**
 * Output results as JSON
 */
function outputJSON(response: SearchResponse): void {
  console.log(JSON.stringify(response, null, 2));
}

/**
 * Output results in human-readable format
 */
function outputPretty(response: SearchResponse): void {
  if (response.results.length === 0) {
    console.log(`No results found for "${response.query}"`);
    return;
  }

  console.log(`Found ${response.total} result${response.total !== 1 ? 's' : ''} for "${response.query}"${response.total > response.results.length ? ` (showing ${response.results.length})` : ''}:\n`);

  for (const result of response.results) {
    const typeIcon = result.type === 'tool' ? '🔧' : result.type === 'prompt' ? '💬' : '📄';
    const score = (result.score * 100).toFixed(0);

    console.log(`${typeIcon} ${result.name} [${result.type}] (${score}%)`);
    console.log(`   Server: ${result.server}`);

    if (result.description) {
      const desc = result.description.length > 100 ? `${result.description.slice(0, 97)}...` : result.description;
      console.log(`   ${desc}`);
    }

    if (result.matchedOn.length > 0) {
      console.log(`   Matched: ${result.matchedOn.join(', ')}`);
    }

    console.log('');
  }
}
