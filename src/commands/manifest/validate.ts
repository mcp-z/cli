import * as fs from 'fs';
import type { MCPConfiguration, ServerConfig } from '../../types.ts';
import { isHttpServer, isStdioServer } from '../../types.ts';
import { MetadataReader, type ServerMetadata } from './metadata-reader.ts';

interface ValidationResult {
  valid: boolean;
  severity?: 'error' | 'warning';
  message?: string;
}

const metadataReader = new MetadataReader();

export async function validateCommand(filePath: string): Promise<void> {
  // 1. Check file exists
  if (!fs.existsSync(filePath)) {
    throw Object.assign(new Error(`File not found: ${filePath}`), { code: 1 });
  }

  // 2. JSON syntax validation
  let config: MCPConfiguration;
  try {
    config = JSON.parse(fs.readFileSync(filePath, 'utf8')) as MCPConfiguration;
  } catch (error) {
    throw Object.assign(new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`), {
      code: 1,
    });
  }

  // 3. Schema validation - check basic structure
  if (!config.mcpServers || typeof config.mcpServers !== 'object') {
    throw Object.assign(new Error('Config must have "mcpServers" object'), { code: 1 });
  }

  console.log(`✅ ${filePath} has valid JSON structure\n`);
  console.log('Server Configuration Validation:\n');

  // 4. Validate each server
  let hasErrors = false;
  let hasWarnings = false;

  const servers = Object.entries(config.mcpServers);

  if (servers.length === 0) {
    console.log('  ⚠️  No servers configured');
    return;
  }

  for (const [serverName, serverConfig] of servers) {
    const validation = await validateServerConfig(serverName, serverConfig);

    if (validation.valid) {
      console.log(`  ✅ ${serverName}: Valid configuration`);
    } else if (validation.severity === 'error') {
      console.log(`  ❌ ${serverName}: ${validation.message}`);
      hasErrors = true;
    } else {
      console.log(`  ⚠️  ${serverName}: ${validation.message}`);
      hasWarnings = true;
    }
  }

  console.log('');

  if (hasErrors) {
    throw Object.assign(new Error('Validation failed with errors'), { code: 1 });
  }

  if (hasWarnings) {
    console.log('⚠️  Validation passed with warnings');
  } else {
    console.log('✅ All validations passed');
  }
}

async function validateServerConfig(serverName: string, serverConfig: ServerConfig): Promise<ValidationResult> {
  // Check basic structure based on server type
  if (isHttpServer(serverConfig)) {
    // HTTP server validation
    if (!serverConfig.url) {
      return {
        valid: false,
        severity: 'error',
        message: 'HTTP server missing required "url" field',
      };
    }
    // If has start block, validate it
    if (serverConfig.start) {
      if (!serverConfig.start.command) {
        return {
          valid: false,
          severity: 'error',
          message: 'HTTP server "start" block missing required "command" field',
        };
      }
      if (serverConfig.start.args !== undefined && !Array.isArray(serverConfig.start.args)) {
        return {
          valid: false,
          severity: 'error',
          message: 'HTTP server "start.args" field must be an array',
        };
      }
    }
  } else {
    // Stdio server validation
    if (!serverConfig.command) {
      return {
        valid: false,
        severity: 'error',
        message: 'Stdio server missing required "command" field',
      };
    }
    if (serverConfig.args !== undefined && !Array.isArray(serverConfig.args)) {
      return {
        valid: false,
        severity: 'error',
        message: 'Stdio server "args" field must be an array',
      };
    }
  }

  // Try to load server metadata
  let metadata: ServerMetadata;
  try {
    metadata = await metadataReader.readServerMetadata(serverName);
  } catch (error) {
    return {
      valid: false,
      severity: 'warning',
      message: `Cannot verify: server package not found (${error instanceof Error ? error.message : String(error)})`,
    };
  }

  // Detect transport using type guard
  const transport = isHttpServer(serverConfig) ? 'streamable-http' : 'stdio';

  // Get package config from server.json
  const pkg = metadataReader.getPackageForTransport(metadata, transport as 'stdio' | 'streamable-http');
  if (!pkg) {
    return {
      valid: false,
      severity: 'error',
      message: `No ${transport} transport configuration found in server.json`,
    };
  }

  // Determine which env to check based on server type
  const envToCheck = isStdioServer(serverConfig) ? serverConfig.env : serverConfig.start?.env;

  // Check for missing required env vars (based on server.json)
  const missingEnvVars = pkg.environmentVariables.filter((v) => {
    if (!v.isRequired) return false; // Skip optional vars
    const envValue = envToCheck?.[v.name];
    // Consider it missing if it's not set or is a placeholder like ${VAR_NAME}
    return !envValue || envValue.match(/^\$\{.*\}$/);
  });

  if (missingEnvVars.length > 0) {
    const varNames = missingEnvVars.map((v) => v.name).join(', ');
    return {
      valid: false,
      severity: 'warning',
      message: `Missing or placeholder required env vars: ${varNames}`,
    };
  }

  // Get args to validate based on server type
  const argsToCheck = isStdioServer(serverConfig) ? serverConfig.args || [] : serverConfig.start?.args || [];

  // Get valid args from server.json
  const validArgNames = new Set(pkg.packageArguments.map((a) => a.name));

  // Check for unknown/outdated args
  const unknownArgs = argsToCheck.filter((arg: string) => {
    if (!arg.startsWith('--')) return false; // Not a flag
    const argName = arg.split('=')[0]; // Get just the flag name
    if (!argName) return false; // Skip if somehow empty
    return !validArgNames.has(argName);
  });

  if (unknownArgs.length > 0) {
    return {
      valid: false,
      severity: 'warning',
      message: `Unknown arguments: ${unknownArgs.join(', ')}. May be outdated - consider regenerating config.`,
    };
  }

  return { valid: true };
}
