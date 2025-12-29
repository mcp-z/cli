/**
 * inspect.ts
 *
 * Inspect MCP servers: explore tools, resources, prompts, and health status.
 * Supports stdio (spawned) and http (remote) servers per MCP spec.
 */

import { createServerRegistry, type PromptArgument, type ServerRegistry, type ServersConfig } from '@mcp-z/client';
import * as fs from 'fs';
import * as path from 'path';
import { findConfigPath } from '../lib/find-config.ts';
import { isHttpServer, type ServerConfig } from '../types.ts';

const MAX_DESCRIPTION = 100;

export interface InspectOptions {
  config?: string; // --config custom.json
  servers?: string; // --servers echo-server-1,echo-server-2 (comma-separated)
  tools?: boolean; // --tools
  resources?: boolean; // --resources
  prompts?: boolean; // --prompts
  health?: boolean; // --health
  json?: boolean; // --json
  verbose?: boolean; // --verbose
  attach?: boolean; // --attach (connect to running servers instead of spawning)
}

interface ServerInfo {
  name: string;
  status: 'ready' | 'failed';
  startupTime: number | undefined;
  error: string | undefined;
  tools: ToolInfo[] | undefined;
  resources: ResourceInfo[] | undefined;
  prompts: PromptInfo[] | undefined;
}

interface ToolInfo {
  name: string;
  description: string | undefined;
  inputSchema: unknown;
}

interface ResourceInfo {
  uri: string;
  name: string;
  description: string | undefined;
  mimeType: string | undefined;
}

interface PromptInfo {
  name: string;
  description: string | undefined;
  arguments: PromptArgument[] | undefined;
}

/**
 * Main inspect command implementation.
 *
 * @param opts - Inspect options from CLI flags
 *
 * @example
 * // Show summary of .mcp.json servers (spawns servers)
 * await inspectCommand({});
 *
 * @example
 * // Show all tools from echo server (spawns server)
 * await inspectCommand({ servers: 'echo', tools: true });
 *
 * @example
 * // Connect to running servers (attach mode)
 * await inspectCommand({ config: 'http-servers.json', attach: true, health: true });
 */
export async function inspectCommand(opts: InspectOptions = {}): Promise<void> {
  let registry: ServerRegistry | undefined;

  try {
    const configPath = findConfigPath(opts.config);
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const servers = raw.mcpServers ?? raw.servers ?? raw;
    const configDir = path.dirname(configPath);
    const serverNames = Object.keys(servers || {});
    const serversToInspect = filterServers(serverNames, opts.servers);

    // Create registry (spawns stdio servers, registers HTTP servers)
    // In attach mode, don't spawn - just register for connection
    registry = createServerRegistry(servers, {
      cwd: configDir,
      dialects: opts.attach ? [] : ['servers', 'start'], // Empty dialects = no spawning
    });

    const serverInfos: ServerInfo[] = [];
    for (const serverName of serversToInspect) {
      const info = await inspectServer(serverName, servers, registry, opts);
      serverInfos.push(info);
    }

    // 5. Output results
    if (opts.json) {
      outputJSON(serverInfos);
    } else {
      outputPretty(serverInfos, opts);
    }
  } finally {
    // 6. Cleanup - registry.close() handles all clients and servers
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
 * Filter servers based on --servers flag.
 */
function filterServers(allServers: string[], serversFlag?: string): string[] {
  if (!serversFlag) {
    return allServers;
  }

  const requested = serversFlag.split(',').map((s) => s.trim());
  const missing = requested.filter((s) => !allServers.includes(s));

  if (missing.length > 0) {
    throw new Error(`Server(s) not found in config: ${missing.join(', ')}\n\nAvailable servers: ${allServers.join(', ')}`);
  }

  return requested;
}

/**
 * Inspect a single server: collect tools, resources, prompts, health.
 */
async function inspectServer(serverName: string, servers: ServersConfig, registry: ServerRegistry, opts: InspectOptions): Promise<ServerInfo> {
  const start = Date.now();

  try {
    // Connect to server via registry
    const serverConfig = servers?.[serverName];
    if (!serverConfig) {
      throw new Error(`Server ${serverName} not found in config`);
    }

    if (!isHttpServer(serverConfig as ServerConfig) && !serverConfig.command) {
      throw new Error(`Stdio server ${serverName} missing required "command" field`);
    }

    const client = await registry.connect(serverName);

    // Collect content based on flags
    const needsTools = opts.tools || shouldShowSummary(opts);
    const needsResources = opts.resources || shouldShowSummary(opts);
    const needsPrompts = opts.prompts || shouldShowSummary(opts);

    // Handle each capability independently - servers may not implement all methods
    const [toolsResult, resourcesResult, promptsResult] = await Promise.all([needsTools ? client.listTools().catch(() => null) : Promise.resolve(null), needsResources ? client.listResources().catch(() => null) : Promise.resolve(null), needsPrompts ? client.listPrompts().catch(() => null) : Promise.resolve(null)]);

    const startupTime = Date.now() - start;

    return {
      name: serverName,
      status: 'ready',
      startupTime,
      error: undefined,
      tools: toolsResult?.tools
        ? toolsResult.tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          }))
        : undefined,
      resources: resourcesResult?.resources
        ? resourcesResult.resources.map((r) => ({
            uri: r.uri,
            name: r.name,
            description: r.description,
            mimeType: r.mimeType,
          }))
        : undefined,
      prompts: promptsResult?.prompts
        ? promptsResult.prompts.map((p) => ({
            name: p.name,
            description: p.description,
            arguments: p.arguments,
          }))
        : undefined,
    };
  } catch (error) {
    // Format error message with context
    let errorMessage = error instanceof Error ? error.message : String(error);

    // For fetch errors, dig into the cause for more details
    if (error instanceof Error && error.message === 'fetch failed' && 'cause' in error) {
      const cause = error.cause as { code?: string; message?: string } | undefined;
      if (cause?.code === 'ECONNREFUSED') {
        const serverConfig = servers?.[serverName];
        const url = serverConfig && 'url' in serverConfig ? serverConfig.url : undefined;
        errorMessage = url ? `Connection refused (server not running at ${url})` : 'Connection refused (server not running)';
      } else if (cause?.message) {
        errorMessage = `${error.message}: ${cause.message}`;
      }
    }

    return {
      name: serverName,
      status: 'failed',
      startupTime: undefined,
      error: errorMessage,
      tools: undefined,
      resources: undefined,
      prompts: undefined,
    };
  }
}

/**
 * Determine if we should show summary (no specific content flags).
 */
function shouldShowSummary(opts: InspectOptions): boolean {
  return !opts.tools && !opts.resources && !opts.prompts && !opts.health;
}

/**
 * Truncate description to max length with ellipsis.
 */
function truncateDescription(desc: string, _maxLength = MAX_DESCRIPTION): string {
  return desc;
  // if (!desc || desc.length <= maxLength) {
  //   return desc;
  // }
  // return `${desc.slice(0, maxLength - 3)}...`;
}

/**
 * Render verbose details for a tool (parameters with types and descriptions)
 */
function renderToolVerbose(tool: ToolInfo, indent: string): void {
  // Description is already shown inline, so skip it here
  const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  if (!schema || !schema.properties) {
    return;
  }

  const properties = schema.properties;
  const required = schema.required || [];

  // Separate required and optional parameters
  const requiredParams: string[] = [];
  const optionalParams: string[] = [];

  for (const [name, _prop] of Object.entries(properties)) {
    if (required.includes(name)) {
      requiredParams.push(name);
    } else {
      optionalParams.push(name);
    }
  }

  // Show required parameters
  if (requiredParams.length > 0) {
    console.log(`${indent}Required Parameters:`);
    for (const name of requiredParams) {
      renderParameter(name, properties[name], `${indent}  `);
    }
    console.log('');
  }

  // Show optional parameters
  if (optionalParams.length > 0) {
    console.log(`${indent}Optional Parameters:`);
    for (const name of optionalParams) {
      renderParameter(name, properties[name], `${indent}  `);
    }
    console.log('');
  }
}

/**
 * Render verbose details for a resource
 */
function renderResourceVerbose(resource: ResourceInfo, indent: string): void {
  // Description is already shown inline, so only show URI and MIME type
  if (resource.uri) {
    console.log(`${indent}URI: ${resource.uri}`);
  }
  if (resource.mimeType) {
    console.log(`${indent}MIME Type: ${resource.mimeType}`);
  }
  if (resource.uri || resource.mimeType) {
    console.log('');
  }
}

/**
 * Render verbose details for a prompt
 */
function renderPromptVerbose(prompt: PromptInfo, indent: string): void {
  // Description is already shown inline, so only show arguments
  if (prompt.arguments && Array.isArray(prompt.arguments) && prompt.arguments.length > 0) {
    console.log(`${indent}Arguments:`);
    for (const arg of prompt.arguments) {
      const argObj = arg as { name?: string; description?: string; required?: boolean };
      const name = argObj.name || 'unknown';
      const description = argObj.description || '';
      const required = argObj.required ? ' (required)' : ' (optional)';
      const desc = description ? ` - ${description}` : '';
      console.log(`${indent}  ${name}${required}${desc}`);
    }
    console.log('');
  }
}

/**
 * Render a single parameter with type and description
 */
function renderParameter(name: string, prop: unknown, indent: string): void {
  const p = prop as { description?: string; enum?: unknown[] };
  const type = getParameterType(prop);
  const constraints = getParameterConstraints(prop);
  const typeInfo = constraints ? `(${type}) ${constraints}` : `(${type})`;
  const desc = p.description ? ` - ${p.description}` : '';

  console.log(`${indent}${name} ${typeInfo}${desc}`);

  // Show enum options on separate line if present
  if (p.enum && Array.isArray(p.enum)) {
    console.log(`${indent}  Options: ${p.enum.join(', ')}`);
  }
}

/**
 * Get human-readable type from JSON Schema property
 */
function getParameterType(prop: unknown): string {
  const p = prop as { type?: string | string[]; items?: { type?: string }; anyOf?: Array<{ type?: string }>; enum?: unknown[] };
  if (p.type) {
    if (Array.isArray(p.type)) {
      return p.type.join(' | ');
    }
    if (p.type === 'array' && p.items) {
      const itemType = p.items.type || 'any';
      return `array of ${itemType}`;
    }
    return p.type;
  }

  if (p.anyOf) {
    return p.anyOf.map((s) => s.type || 'any').join(' | ');
  }

  if (p.enum) {
    return 'enum';
  }

  return 'any';
}

/**
 * Get parameter constraints (default, min, max, etc.)
 */
function getParameterConstraints(prop: unknown): string {
  const p = prop as {
    default?: unknown;
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    minItems?: number;
    maxItems?: number;
  };
  const constraints: string[] = [];

  if (p.default !== undefined) {
    const defaultValue = typeof p.default === 'string' ? `"${p.default}"` : String(p.default);
    constraints.push(`default: ${defaultValue}`);
  }

  if (p.minimum !== undefined) {
    constraints.push(`min: ${p.minimum}`);
  }

  if (p.maximum !== undefined) {
    constraints.push(`max: ${p.maximum}`);
  }

  if (p.minLength !== undefined) {
    constraints.push(`minLength: ${p.minLength}`);
  }

  if (p.maxLength !== undefined) {
    constraints.push(`maxLength: ${p.maxLength}`);
  }

  if (p.minItems !== undefined) {
    constraints.push(`minItems: ${p.minItems}`);
  }

  if (p.maxItems !== undefined) {
    constraints.push(`maxItems: ${p.maxItems}`);
  }

  return constraints.length > 0 ? `[${constraints.join(', ')}]` : '';
}

/**
 * Output results as JSON.
 */
function outputJSON(serverInfos: ServerInfo[]): void {
  const output = {
    servers: serverInfos.reduce(
      (acc, info) => {
        acc[info.name] = {
          status: info.status,
          startupTime: info.startupTime ? `${(info.startupTime / 1000).toFixed(1)}s` : undefined,
          error: info.error,
          tools: info.tools,
          resources: info.resources,
          prompts: info.prompts,
        };
        return acc;
      },
      {} as Record<string, unknown>
    ),
  };

  console.log(JSON.stringify(output, null, 2));
}

/**
 * Output results in human-readable format.
 */
function outputPretty(serverInfos: ServerInfo[], opts: InspectOptions): void {
  const showSummary = shouldShowSummary(opts);

  for (const info of serverInfos) {
    // Summary mode
    if (showSummary) {
      if (info.status === 'ready') {
        const toolCount = info.tools?.length || 0;
        const resourceCount = info.resources?.length || 0;
        const promptCount = info.prompts?.length || 0;
        const time = info.startupTime ? `(${(info.startupTime / 1000).toFixed(1)}s)` : '';
        console.log(`📦 ${info.name}: ${time}`);

        // Show detailed list of tools
        console.log(`tools: ${toolCount}`);
        if (info.tools && info.tools.length > 0) {
          for (let i = 0; i < info.tools.length; i++) {
            const tool = info.tools[i];
            if (!tool) continue; // Array indexing can return undefined with noUncheckedIndexedAccess
            const desc = tool.description ? ` - ${opts.verbose ? tool.description : truncateDescription(tool.description)}` : '';
            console.log(`${i + 1}. ${tool.name}${desc}`);
            if (opts.verbose) {
              renderToolVerbose(tool, '   ');
            }
          }
        }

        // Show detailed list of resources
        console.log(`resources: ${resourceCount}`);
        if (info.resources && info.resources.length > 0) {
          for (let i = 0; i < info.resources.length; i++) {
            const resource = info.resources[i];
            if (!resource) continue; // Array indexing can return undefined with noUncheckedIndexedAccess
            const desc = resource.description ? ` - ${opts.verbose ? resource.description : truncateDescription(resource.description)}` : '';
            console.log(`${i + 1}. ${resource.name}${desc}`);
            if (opts.verbose) {
              renderResourceVerbose(resource, '   ');
            }
          }
        }

        // Show detailed list of prompts
        console.log(`prompts: ${promptCount}`);
        if (info.prompts && info.prompts.length > 0) {
          for (let i = 0; i < info.prompts.length; i++) {
            const prompt = info.prompts[i];
            if (!prompt) continue; // Array indexing can return undefined with noUncheckedIndexedAccess
            const desc = prompt.description ? ` - ${opts.verbose ? prompt.description : truncateDescription(prompt.description)}` : '';
            console.log(`${i + 1}. ${prompt.name}${desc}`);
            if (opts.verbose) {
              renderPromptVerbose(prompt, '   ');
            }
          }
        }
      } else {
        console.log(`📦 ${info.name}: ✗ failed - ${info.error}`);
      }
      continue;
    }

    // Health mode
    if (opts.health) {
      if (info.status === 'ready') {
        const time = info.startupTime ? `(${(info.startupTime / 1000).toFixed(1)}s)` : '';
        console.log(`✓ ${info.name} - ready ${time}`);
      } else {
        console.log(`✗ ${info.name} - failed`);
        console.log(`  Error: ${info.error}`);
      }
      continue;
    }

    // Tools mode
    if (opts.tools) {
      console.log(`\n📦 ${info.name} (${info.tools?.length || 0} tools)`);
      if (info.tools && info.tools.length > 0) {
        for (let i = 0; i < info.tools.length; i++) {
          const tool = info.tools[i];
          if (!tool) continue; // Array indexing can return undefined with noUncheckedIndexedAccess
          const desc = tool.description ? ` - ${opts.verbose ? tool.description : truncateDescription(tool.description)}` : '';
          console.log(`  ${i + 1}. ${tool.name}${desc}`);
          if (opts.verbose) {
            renderToolVerbose(tool, '     ');
          }
        }
      }
    }

    // Resources mode
    if (opts.resources) {
      console.log(`\n📦 ${info.name} (${info.resources?.length || 0} resources)`);
      if (info.resources && info.resources.length > 0) {
        for (let i = 0; i < info.resources.length; i++) {
          const resource = info.resources[i];
          if (!resource) continue; // Array indexing can return undefined with noUncheckedIndexedAccess
          const desc = resource.description ? ` - ${opts.verbose ? resource.description : truncateDescription(resource.description)}` : '';
          console.log(`  ${i + 1}. ${resource.name}${desc}`);
          if (opts.verbose) {
            renderResourceVerbose(resource, '     ');
          }
        }
      }
    }

    // Prompts mode
    if (opts.prompts) {
      console.log(`\n📦 ${info.name} (${info.prompts?.length || 0} prompts)`);
      if (info.prompts && info.prompts.length > 0) {
        for (let i = 0; i < info.prompts.length; i++) {
          const prompt = info.prompts[i];
          if (!prompt) continue; // Array indexing can return undefined with noUncheckedIndexedAccess
          const desc = prompt.description ? ` - ${opts.verbose ? prompt.description : truncateDescription(prompt.description)}` : '';
          console.log(`  ${i + 1}. ${prompt.name}${desc}`);
          if (opts.verbose) {
            renderPromptVerbose(prompt, '     ');
          }
        }
      }
    }
  }

  console.log('');
}
