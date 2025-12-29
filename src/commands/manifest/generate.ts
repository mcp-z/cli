import checkbox from '@inquirer/checkbox';
import confirm from '@inquirer/confirm';
import input from '@inquirer/input';
import select from '@inquirer/select';
import * as fs from 'fs';
import * as path from 'path';
import { validateSchema } from '../../lib/json-schema.ts';
import type { MCPConfiguration, ServerConfig, ServerConfigHttp, ServerConfigStdio } from '../../types.ts';
import { promptForEnvVars, substituteTemplateVars } from './env-prompting.ts';
import { type CliArgMetadata, type EnvVarMetadata, MetadataReader, type ServerMetadata } from './metadata-reader.ts';

export type ConfigurationMode = 'env' | 'args' | 'both' | 'none';

export interface Dimension {
  name: string;
  type: 'env' | 'arg';
  choices: string[];
}

export interface Combination {
  name: string;
  envKeys: string[]; // List of environment variable names needed for this combination
  argNames: string[]; // List of package argument names needed for this combination
  defaults: Record<string, string>; // Default values for non-dimension env vars
  argDefaults: Record<string, string>; // Default values for non-dimension args
  dimensionValues: Record<string, string>; // Dimension values for this combination (both env and args)
}

export interface ConfigChoice {
  combination: Combination;
  transport: 'stdio' | 'streamable-http';
  label: string;
}

/** Maps user-facing transport names to internal types */
export const TRANSPORT_MAP: Record<string, 'stdio' | 'streamable-http'> = {
  stdio: 'stdio',
  http: 'streamable-http',
};

/**
 * Build config choices from combinations and transports.
 * Used for both "select all" and "select specific" flows.
 * @param combinations - Array of config combinations
 * @param transports - Array of transport names ('stdio', 'http', or 'streamable-http')
 * @returns Array of ConfigChoice objects
 */
export function createConfigChoices(combinations: Combination[], transports: string[]): ConfigChoice[] {
  const choices: ConfigChoice[] = [];
  for (const combination of combinations) {
    for (const t of transports) {
      const transport = TRANSPORT_MAP[t] || (t as 'stdio' | 'streamable-http');
      choices.push({
        combination,
        transport,
        label: `${combination.name} (${t})`,
      });
    }
  }
  return choices;
}

/**
 * Filter config choices by selected labels.
 * @param allChoices - All available config choices
 * @param selectedLabels - Labels of configs to include
 * @returns Filtered array of ConfigChoice objects
 */
export function filterConfigChoices(allChoices: ConfigChoice[], selectedLabels: string[]): ConfigChoice[] {
  return allChoices.filter((choice) => selectedLabels.includes(choice.label));
}

/**
 * Generate cartesian product of all dimension choices.
 * Example: [AUTH_MODE: [a, b], DCR_MODE: [x, y]] → [[a,x], [a,y], [b,x], [b,y]]
 */
function generateCartesianProduct(dimensions: Array<{ name: string; choices?: string[] }>): string[][] {
  if (dimensions.length === 0) return [[]];

  const first = dimensions[0];
  if (!first || !first.choices || first.choices.length === 0) return [[]];

  if (dimensions.length === 1) {
    return first.choices.map((c) => [c]);
  }

  const rest = dimensions.slice(1);
  const restProduct = generateCartesianProduct(rest);

  const result: string[][] = [];
  for (const choice of first.choices) {
    for (const restCombination of restProduct) {
      result.push([choice, ...restCombination]);
    }
  }

  return result;
}

/**
 * Generate combinations from env vars with choices (simple cartesian product).
 * All combinations are generated - user can filter via selection pass.
 */
export function generateMatrixCombinations(envVars: Array<{ name: string; choices: string[] }>): Combination[] {
  const dimensions = envVars.map((e) => ({ name: e.name, choices: e.choices }));
  const product = generateCartesianProduct(dimensions);

  return product.map((values) => {
    const dimensionValues: Record<string, string> = {};
    dimensions.forEach((dim, i) => {
      dimensionValues[dim.name] = values[i] || '';
    });
    const nameParts = dimensions.map((dim, i) => `${dim.name.toLowerCase()}-${values[i]}`);
    return {
      name: nameParts.length > 0 ? nameParts.join('_') : 'minimal',
      envKeys: dimensions.map((d) => d.name),
      argNames: [],
      defaults: {},
      argDefaults: {},
      dimensionValues,
    };
  });
}

/**
 * Generate combinations respecting dependsOn relationships.
 * Conditional dimensions are only included when their dependencies are satisfied.
 * Example: DCR_MODE only generates variations when AUTH_MODE=dcr
 */
export function generateConditionalCombinations(envVars: Array<{ name: string; choices: string[]; dependsOn?: Record<string, string[]> }>): Combination[] {
  // Separate primary dimensions (no dependsOn) from conditional ones
  const primaryDims = envVars.filter((e) => !e.dependsOn);
  const conditionalDims = envVars.filter((e) => e.dependsOn);

  if (primaryDims.length === 0) {
    // No primary dimensions - return empty or minimal
    return [
      {
        name: 'minimal',
        envKeys: [],
        argNames: [],
        defaults: {},
        argDefaults: {},
        dimensionValues: {},
      },
    ];
  }

  // Generate all combinations of primary dimensions first
  const primaryProduct = generateCartesianProduct(primaryDims);

  const combinations: Combination[] = [];

  for (const primaryValues of primaryProduct) {
    // Build base dimension values from primary
    const baseDimensionValues: Record<string, string> = {};
    primaryDims.forEach((dim, i) => {
      baseDimensionValues[dim.name] = primaryValues[i] || '';
    });

    // Find which conditional dimensions apply to this primary combination
    const applicableConditionals = conditionalDims.filter((cond) => shouldPromptEnvVar(cond, baseDimensionValues));

    if (applicableConditionals.length === 0) {
      // No conditional dimensions apply - single combination
      // Only include dimensions with multiple choices in the name (single-choice dimensions don't add discriminating value)
      const nameParts = primaryDims.filter((dim) => dim.choices.length > 1).map((dim, _i) => `${dim.name.toLowerCase()}-${primaryValues[primaryDims.indexOf(dim)]}`);
      combinations.push({
        name: nameParts.length > 0 ? nameParts.join('_') : 'default',
        envKeys: primaryDims.map((d) => d.name),
        argNames: [],
        defaults: {},
        argDefaults: {},
        dimensionValues: { ...baseDimensionValues },
      });
    } else {
      // Generate sub-combinations for applicable conditional dimensions
      const conditionalProduct = generateCartesianProduct(applicableConditionals);

      for (const condValues of conditionalProduct) {
        const fullDimensionValues: Record<string, string> = { ...baseDimensionValues };
        applicableConditionals.forEach((dim, i) => {
          fullDimensionValues[dim.name] = condValues[i] || '';
        });

        // Build name from dimensions with multiple choices only (single-choice dimensions don't add discriminating value)
        const allDims = [...primaryDims, ...applicableConditionals];
        const nameParts = allDims.filter((dim) => dim.choices.length > 1).map((dim) => `${dim.name.toLowerCase()}-${fullDimensionValues[dim.name]}`);

        combinations.push({
          name: nameParts.length > 0 ? nameParts.join('_') : 'default',
          envKeys: [...primaryDims, ...applicableConditionals].map((d) => d.name),
          argNames: [],
          defaults: {},
          argDefaults: {},
          dimensionValues: fullDimensionValues,
        });
      }
    }
  }

  return combinations;
}

/**
 * Check if an environment variable should be prompted based on dependsOn conditions.
 * Returns true if the envVar has no dependencies, or if all dependencies are satisfied.
 *
 * @param envVar - Environment variable metadata with optional dependsOn field
 * @param selectedValues - Currently selected dimension values (e.g., { AUTH_MODE: 'loopback-oauth' })
 * @returns true if the env var should be prompted, false if it should be skipped
 */
export function shouldPromptEnvVar(envVar: { dependsOn?: Record<string, string[]> }, selectedValues: Record<string, string>): boolean {
  if (!envVar.dependsOn) return true;

  // All dependencies must be satisfied
  for (const [depName, allowedValues] of Object.entries(envVar.dependsOn)) {
    const selectedValue = selectedValues[depName];
    // If dependency not yet selected, or selected value not in allowed list, skip
    if (!selectedValue || !allowedValues.includes(selectedValue)) {
      return false;
    }
  }
  return true;
}

/**
 * Generate server configuration interactively.
 * Discovers server.json in current directory, prompts for configuration,
 * and generates config files for selected combinations and transports.
 *
 * @param options - Command options
 * @param options.source - Use source code paths (node instead of npx)
 * @param options.json - Output to stdout instead of writing files
 * @param options.matrix - Non-interactive mode: generate all matrix combinations
 * @param options.output - Output directory (default: examples for --matrix, . otherwise)
 * @param options.quick - Skip all optional env var prompts, use defaults
 */
export async function generateCommand(options: { source?: boolean; json?: boolean; matrix?: boolean; output?: string; quick?: boolean } = {}): Promise<void> {
  console.log('🔧 MCP Config Generator\n');

  const useSource = options.source || false;
  const jsonOutput = options.json || false;
  const matrixMode = options.matrix || false;
  const quickMode = options.quick || false;

  // 1. Discover server.json in current directory or parent
  const serverJsonPath = discoverServerJson();
  if (!serverJsonPath) {
    console.error('❌ No server.json found in current directory or parent');
    console.error('   Run this command from an MCP server package directory');
    process.exit(1);
  }

  // 2. Read package.json to get package name
  const packageDir = path.dirname(serverJsonPath);
  const packageJsonPath = path.join(packageDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    console.error('❌ No package.json found alongside server.json');
    console.error('   Package.json is required to get package name');
    process.exit(1);
  }

  const packageJson: { name: string; bin?: string | Record<string, string> } = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const packageName = packageJson.name;
  const serverName = extractServerName(packageName);

  // Get bin entry for source mode
  let binPath: string | undefined;
  if (packageJson.bin) {
    if (typeof packageJson.bin === 'string') {
      // Default bin entry
      binPath = packageJson.bin;
    } else {
      // Named bin entries - try to match package name without org
      const packageNameWithoutOrg = packageName.replace(/^@[^/]+\//, '');
      binPath = packageJson.bin[packageNameWithoutOrg] || packageJson.bin[Object.keys(packageJson.bin)[0] || ''];
    }
  }

  console.log(`📦 Package: ${packageName}`);

  // 3. Read and validate server.json metadata
  const serverJsonContent = fs.readFileSync(serverJsonPath, 'utf-8');
  let metadata: ServerMetadata;
  try {
    metadata = JSON.parse(serverJsonContent);
    await validateSchema(metadata, serverName);
  } catch (error) {
    console.error(`❌ Failed to read or validate server.json: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const metadataReader = new MetadataReader();

  // 4. Get stdio package to analyze env vars
  const stdioPackage = metadataReader.getPackageForTransport(metadata, 'stdio');
  if (!stdioPackage) {
    console.error('❌ No stdio transport found in server.json');
    process.exit(1);
  }

  // 5. Find all environment variables and package arguments with choices
  // Filter to only mandatory matrix items (isMandatoryForMatrix !== false)
  // Non-mandatory items like LOG_LEVEL should not explode the test matrix
  const envVarsWithChoices = (stdioPackage.environmentVariables || []).filter((envVar) => envVar.choices && envVar.choices.length > 0 && envVar.isMandatoryForMatrix !== false);
  const argsWithChoices = (stdioPackage.packageArguments || []).filter((arg): arg is CliArgMetadata & { choices: string[] } => arg.choices !== undefined && arg.choices.length > 0);

  if (envVarsWithChoices.length === 0 && argsWithChoices.length === 0) {
    console.error('❌ No environment variables or package arguments with choices found in server.json');
    console.error('   Cannot generate configurations without choice-based configuration options');
    process.exit(1);
  }

  console.log('\n🔍 Available configuration options:');
  if (envVarsWithChoices.length > 0) {
    console.log(`   Environment variables (${envVarsWithChoices.length}):`);
    for (const envVar of envVarsWithChoices) {
      console.log(`   • ${envVar.name}: ${envVar.choices?.join(', ') || ''}`);
    }
  }
  if (argsWithChoices.length > 0) {
    console.log(`   Package arguments (${argsWithChoices.length}):`);
    for (const arg of argsWithChoices) {
      console.log(`   • ${arg.name}: ${arg.choices?.join(', ') || ''}`);
    }
  }
  console.log();

  // Matrix mode: non-interactive generation of all combinations
  if (matrixMode) {
    const outputDir = options.output || 'examples';
    const transports: Array<'stdio' | 'streamable-http'> = ['stdio'];

    // Add http transport if available
    const httpPackage = metadataReader.getPackageForTransport(metadata, 'streamable-http');
    if (httpPackage) {
      transports.push('streamable-http');
    }

    // Build env vars for matrix generation (with dependsOn for conditional filtering)
    const envVarsForMatrix = envVarsWithChoices.map((envVar) => ({
      name: envVar.name,
      choices: envVar.choices || [],
      dependsOn: envVar.dependsOn,
    }));

    // Collect defaults for non-dimension env vars (ones without choices or non-mandatory)
    // Support both 'default' (MCP schema standard) and 'value' (legacy) fields
    const defaults: Record<string, string> = {};
    for (const envVar of stdioPackage.environmentVariables || []) {
      if (!envVarsWithChoices.some((e) => e.name === envVar.name)) {
        const defaultValue = envVar.default ?? envVar.value;
        if (defaultValue) {
          defaults[envVar.name] = defaultValue;
        }
      }
    }

    // Generate combinations respecting dependsOn relationships (no unnecessary combinations)
    const combinations = generateConditionalCombinations(envVarsForMatrix);

    // Add defaults to each combination
    for (const combo of combinations) {
      combo.defaults = defaults;
    }

    console.log(`📊 Matrix mode: Generating ${combinations.length} combination(s) × ${transports.length} transport(s)`);
    console.log(`   Output: ${outputDir}/`);
    console.log(`   Transports: ${transports.join(', ')}`);
    console.log();

    // Create output directory
    fs.mkdirSync(outputDir, { recursive: true });

    // Default HTTP settings for matrix mode
    const httpHost = 'localhost';
    const httpPort = 3000;

    let generatedCount = 0;
    for (const combination of combinations) {
      for (const transport of transports) {
        await generateConfigFile({
          serverName,
          combination,
          transport,
          outputDir,
          packageName,
          packageDir,
          ...(binPath !== undefined && { binPath }),
          metadata,
          metadataReader,
          httpHost,
          httpPort,
          useSource,
          quick: true, // Matrix mode always uses defaults
        });
        generatedCount++;
      }
    }

    console.log(`\n✅ Generated ${generatedCount} config file(s) in ${outputDir}`);
    return;
  }

  // 5a. Ask what to configure (env/args/both/none)
  const configMode = await select<ConfigurationMode>({
    message: 'What do you want to configure?',
    choices: [
      { name: 'Environment variables only', value: 'env' as const, disabled: envVarsWithChoices.length === 0 },
      { name: 'Package arguments only', value: 'args' as const, disabled: argsWithChoices.length === 0 },
      {
        name: 'Both environment variables and package arguments',
        value: 'both' as const,
        disabled: envVarsWithChoices.length === 0 || argsWithChoices.length === 0,
      },
      { name: 'None (minimal server config)', value: 'none' as const },
    ].filter((choice) => !choice.disabled),
  });

  if (configMode === 'none') {
    // Generate single minimal config
    const finalServerName = await input({
      message: 'Server name for mcpServers config:',
      default: serverName,
      validate: (input: string) => input.length > 0 || 'Server name is required',
    });

    const outputDir = jsonOutput
      ? '.'
      : await input({
          message: 'Output directory:',
          default: '.',
        });

    const combination: Combination = {
      name: 'minimal',
      envKeys: [],
      argNames: [],
      defaults: {},
      argDefaults: {},
      dimensionValues: {},
    };

    if (jsonOutput) {
      const config = await generateConfigObject({
        serverName: finalServerName,
        combination,
        transport: 'stdio',
        packageName,
        packageDir,
        ...(binPath !== undefined && { binPath }),
        metadata,
        metadataReader,
        useSource,
        quick: quickMode,
      });
      console.log(JSON.stringify(config, null, 2));
    } else {
      fs.mkdirSync(outputDir, { recursive: true });
      await generateConfigFile({
        serverName: finalServerName,
        combination,
        transport: 'stdio',
        outputDir,
        packageName,
        packageDir,
        ...(binPath !== undefined && { binPath }),
        metadata,
        metadataReader,
        useSource,
        quick: quickMode,
      });
      console.log(`\n✅ Generated 1 config file in ${outputDir}`);
    }
    return;
  }

  // 6. Select transports
  const transports = await checkbox({
    message: 'Select transports:',
    choices: [
      { name: 'stdio', value: 'stdio', checked: true },
      { name: 'http', value: 'http', checked: true },
    ],
    validate: (choices: readonly unknown[]) => choices.length > 0 || 'Select at least one transport',
  });

  // 7. HTTP configuration if HTTP transport selected
  let httpHost = 'localhost';
  let httpPort = 3000;

  if (transports.includes('http')) {
    httpHost = await input({
      message: 'HTTP host:',
      default: 'localhost',
    });

    const portStr = await input({
      message: 'HTTP port:',
      default: '3000',
      validate: (input: string) => {
        const port = Number.parseInt(input, 10);
        return (!Number.isNaN(port) && port > 0 && port < 65536) || 'Port must be between 1 and 65535';
      },
    });

    httpPort = Number.parseInt(portStr, 10);
  }

  // 8. Collect available dimensions based on configuration mode
  const availableDimensions: Dimension[] = [];

  if (configMode === 'env' || configMode === 'both') {
    for (const envVar of envVarsWithChoices) {
      availableDimensions.push({
        name: envVar.name,
        type: 'env',
        choices: envVar.choices || [],
      });
    }
  }

  if (configMode === 'args' || configMode === 'both') {
    for (const arg of argsWithChoices) {
      availableDimensions.push({
        name: arg.name,
        type: 'arg',
        choices: arg.choices,
      });
    }
  }

  // 8a. Ask user which dimensions to use for combinations
  const selectedDimensionNames = await checkbox({
    message: 'Select dimensions to generate combinations from (order determines filename pattern):',
    choices: availableDimensions.map((d) => ({
      name: `${d.type === 'env' ? 'ENV' : 'ARG'} ${d.name} (${d.choices.join(', ')})`,
      value: d.name,
      checked: true, // Default to all selected
    })),
    validate: (choices: readonly unknown[]) => choices.length > 0 || 'Select at least one dimension',
  });

  const selectedDimensions = availableDimensions.filter((d) => selectedDimensionNames.includes(d.name));

  // 9. For each dimension, select which choices to include (with "skip" option)
  const dimensionsWithFilteredChoices: Dimension[] = [];

  for (const dim of selectedDimensions) {
    const choicesWithSkip = [...dim.choices, 'skip'];
    const selectedChoices = await checkbox({
      message: `For ${dim.type === 'env' ? 'ENV' : 'ARG'} ${dim.name}, select choices to include:`,
      choices: choicesWithSkip.map((choice) => ({
        name: choice === 'skip' ? 'skip (do not configure)' : choice,
        value: choice,
        checked: choice !== 'skip', // Default all except skip
      })),
      validate: (choices: readonly unknown[]) => choices.length > 0 || 'Select at least one choice (or skip)',
    });

    dimensionsWithFilteredChoices.push({
      ...dim,
      choices: selectedChoices,
    });
  }

  // 10. For non-dimensions with choices, get default values (including "skip")
  const dimensionNames = selectedDimensions.map((d) => d.name);
  const nonDimensionEnvVars = envVarsWithChoices.filter((e) => !dimensionNames.includes(e.name));
  const nonDimensionArgs = argsWithChoices.filter((a) => !dimensionNames.includes(a.name));

  const defaults: Record<string, string> = {};
  const argDefaults: Record<string, string> = {};

  // Get defaults for env vars (if configured)
  if (configMode === 'env' || configMode === 'both') {
    for (const envVar of nonDimensionEnvVars) {
      const choicesWithSkip = [...(envVar.choices || []), 'skip'];
      const defaultValue = await select({
        message: `Select default value for ENV ${envVar.name} (used in all configs)`,
        choices: choicesWithSkip.map((c) => ({ name: c === 'skip' ? 'skip (do not configure)' : c, value: c })),
      });

      if (defaultValue !== 'skip') {
        defaults[envVar.name] = defaultValue as string;
      }
    }
  }

  // Get defaults for args (if configured)
  if (configMode === 'args' || configMode === 'both') {
    for (const arg of nonDimensionArgs) {
      const choicesWithSkip = [...arg.choices, 'skip'];
      const defaultValue = await select({
        message: `Select default value for ARG ${arg.name} (used in all configs)`,
        choices: choicesWithSkip.map((c) => ({ name: c === 'skip' ? 'skip (do not configure)' : c, value: c })),
      });

      if (defaultValue !== 'skip') {
        argDefaults[arg.name] = defaultValue as string;
      }
    }
  }

  // 11. Generate combinations as cartesian product
  const combinations: Combination[] = generateCartesianProduct(dimensionsWithFilteredChoices).map((choiceValues) => {
    // Build name from dimensions that have multiple choices (single-choice dimensions don't add discriminating value)
    // Also filter out "skip" values
    const nameParts: string[] = [];
    for (let i = 0; i < choiceValues.length; i++) {
      const dim = dimensionsWithFilteredChoices[i];
      const value = choiceValues[i];
      // Only include in name if: not "skip" AND dimension has multiple selected choices
      if (dim && value !== 'skip' && dim.choices.filter((c) => c !== 'skip').length > 1) {
        nameParts.push(value || '');
      }
    }
    const name = nameParts.length > 0 ? nameParts.join('-').toLowerCase() : 'defaults';

    // Map choice values back to dimension names (excluding "skip")
    const dimensionValues: Record<string, string> = {};
    for (let i = 0; i < choiceValues.length; i++) {
      const dimension = dimensionsWithFilteredChoices[i];
      const value = choiceValues[i];
      if (dimension && value !== 'skip') {
        dimensionValues[dimension.name] = value || '';
      }
    }

    // Include env vars and args based on what's configured
    const allEnvKeys = (stdioPackage.environmentVariables || []).map((e) => e.name);
    const allArgNames = (stdioPackage.packageArguments || []).map((a) => a.name);

    return {
      name,
      envKeys: configMode === 'env' || configMode === 'both' ? allEnvKeys : [],
      argNames: configMode === 'args' || configMode === 'both' ? allArgNames : [],
      defaults,
      argDefaults,
      dimensionValues,
    };
  });

  // 12. Show preview with final counts
  const totalConfigs = combinations.length * transports.length;

  console.log('\n📋 Preview:');
  console.log(`   ${combinations.length} combination(s) × ${transports.length} transport(s) = ${totalConfigs} config file(s)`);
  console.log('\n   Combinations:');
  for (const combo of combinations) {
    console.log(`   • ${combo.name}`);
  }
  console.log(`\n   Transports: ${transports.join(', ')}`);

  if (Object.keys(defaults).length > 0) {
    console.log('\n   Default ENV values (used in all configs):');
    for (const [key, value] of Object.entries(defaults)) {
      console.log(`   • ${key}=${value}`);
    }
  }

  if (Object.keys(argDefaults).length > 0) {
    console.log('\n   Default ARG values (used in all configs):');
    for (const [key, value] of Object.entries(argDefaults)) {
      console.log(`   • ${key}=${value}`);
    }
  }
  console.log();

  // 12a. Ask how to proceed
  type GenerationMode = 'all' | 'select' | 'cancel';
  const generationMode = await select<GenerationMode>({
    message: 'How would you like to proceed?',
    choices: [
      { name: 'Generate all configurations', value: 'all' as const },
      { name: 'Select specific configurations', value: 'select' as const },
      { name: 'Cancel', value: 'cancel' as const },
    ],
  });

  if (generationMode === 'cancel') {
    console.log('❌ Cancelled');
    process.exit(0);
  }

  // 12b. If selecting, show checkbox for each combination × transport
  let selectedConfigs: ConfigChoice[];

  // Build all config choices
  const allChoices = createConfigChoices(combinations, transports);

  if (generationMode === 'select') {
    const selectedLabels = await checkbox<string>({
      message: 'Select configurations to generate:',
      choices: allChoices.map((choice) => ({
        name: choice.label,
        value: choice.label,
        checked: true, // Default all selected
      })),
      required: true,
    });

    selectedConfigs = filterConfigChoices(allChoices, selectedLabels);

    if (selectedConfigs.length === 0) {
      console.log('❌ No configurations selected');
      process.exit(0);
    }

    console.log(`\n📋 Selected ${selectedConfigs.length} configuration(s)`);
  } else {
    // Generate all
    selectedConfigs = allChoices;
  }

  // 13. Final prompts
  const finalServerName = await input({
    message: 'Server name for mcpServers config:',
    default: serverName,
    validate: (input: string) => input.length > 0 || 'Server name is required',
  });

  const outputDir = jsonOutput
    ? '.'
    : await input({
        message: 'Output directory:',
        default: '.',
      });

  // 13a. Select which optional env vars to prompt for (per-config prompting happens later)
  // This is just a FILTER - actual prompting happens in buildServerConfig with config context
  const optionalVarsToPrompt = new Set<string>();

  if (!quickMode && process.stdin.isTTY) {
    // Track env vars with their relevance context
    interface EnvVarWithContext {
      envVar: EnvVarMetadata;
      relevantModes: Set<string>; // Which dimension values this var applies to
      appliesToAll: boolean; // True if no dependsOn (applies to all configs)
    }

    const envVarsWithContext = new Map<string, EnvVarWithContext>();

    // Get the primary dimension (usually AUTH_MODE) for context grouping
    const primaryDimensionName = selectedDimensions.length > 0 ? selectedDimensions[0]?.name : undefined;

    for (const { combination } of selectedConfigs) {
      const allEnvVars = stdioPackage.environmentVariables || [];
      for (const envVar of allEnvVars) {
        // Skip if already in defaults or dimension values
        if (combination.envKeys.includes(envVar.name) && Object.keys(combination.dimensionValues).includes(envVar.name)) {
          continue;
        }
        if (Object.keys(combination.defaults).includes(envVar.name)) {
          continue;
        }
        // Check dependsOn
        if (!shouldPromptEnvVar(envVar, combination.dimensionValues)) {
          continue;
        }
        // Only collect optional env vars (required ones are always prompted per-config)
        if (!envVar.isRequired) {
          if (!envVarsWithContext.has(envVar.name)) {
            envVarsWithContext.set(envVar.name, {
              envVar,
              relevantModes: new Set(),
              appliesToAll: !envVar.dependsOn,
            });
          }
          const context = envVarsWithContext.get(envVar.name);
          // Track which primary dimension value this var is relevant to
          if (context && primaryDimensionName && combination.dimensionValues[primaryDimensionName]) {
            context.relevantModes.add(combination.dimensionValues[primaryDimensionName]);
          }
        }
      }
    }

    if (envVarsWithContext.size > 0) {
      // Group env vars by their relevance for clearer display
      const allSelectedModes = new Set(selectedConfigs.map((c) => (primaryDimensionName ? c.combination.dimensionValues[primaryDimensionName] : '')).filter(Boolean));
      const groupedVars: Map<string, EnvVarMetadata[]> = new Map();

      for (const { envVar, relevantModes, appliesToAll } of envVarsWithContext.values()) {
        let groupKey: string;
        if (appliesToAll || relevantModes.size === allSelectedModes.size) {
          groupKey = 'all';
        } else {
          // Sort modes for consistent display
          groupKey = Array.from(relevantModes).sort().join(', ');
        }

        if (!groupedVars.has(groupKey)) {
          groupedVars.set(groupKey, []);
        }
        groupedVars.get(groupKey)?.push(envVar);
      }

      console.log(`\n📋 ${envVarsWithContext.size} optional env var(s) can be configured:`);

      // Build template vars from HTTP settings for placeholder substitution
      const templateVars: Record<string, string> = {};
      if (transports.includes('http') || transports.includes('streamable-http')) {
        templateVars.HOST = httpHost;
        templateVars.PORT = String(httpPort);
      }

      // Display grouped by relevance
      for (const [groupKey, vars] of groupedVars.entries()) {
        if (groupKey === 'all') {
          console.log('\n   For all configurations:');
        } else {
          console.log(`\n   For ${groupKey} mode:`);
        }
        for (const envVar of vars) {
          const rawDefault = envVar.default ?? envVar.value ?? envVar.placeholder;
          const defaultVal = substituteTemplateVars(rawDefault, templateVars);
          const label = defaultVal ? `(default: ${defaultVal})` : '(no default)';
          console.log(`   • ${envVar.name} - ${envVar.description || 'optional'} ${label}`);
        }
      }

      // Build flat list of all optional var names for checkbox selection
      const allOptionalVarNames = Array.from(envVarsWithContext.keys());

      const configureChoice = await select({
        message: '\nConfigure optional env vars?',
        choices: [
          { name: 'None (use defaults)', value: 'none' },
          { name: 'All (prompt for each config)', value: 'all' },
          { name: 'Select specific ones', value: 'select' },
        ],
        default: 'none',
      });

      if (configureChoice === 'all') {
        // Add all optional vars to the prompt set
        for (const name of allOptionalVarNames) {
          optionalVarsToPrompt.add(name);
        }
      } else if (configureChoice === 'select') {
        // Show multi-select checkbox grouped by relevance
        const checkboxChoices = [];

        for (const [groupKey, vars] of groupedVars.entries()) {
          // Add group separator
          checkboxChoices.push({
            name: groupKey === 'all' ? '── For all configurations ──' : `── For ${groupKey} mode ──`,
            value: `__separator__${groupKey}`,
            disabled: ' ',
          });

          for (const envVar of vars) {
            const rawDefault = envVar.default ?? envVar.value ?? envVar.placeholder;
            const defaultVal = substituteTemplateVars(rawDefault, templateVars);
            const label = defaultVal ? ` (default: ${defaultVal})` : '';
            checkboxChoices.push({
              name: `${envVar.name} - ${envVar.description || 'optional'}${label}`,
              value: envVar.name,
            });
          }
        }

        const selectedVarNames = (await checkbox({
          message: 'Select which env vars to configure:',
          choices: checkboxChoices,
        })) as string[];

        // Add selected vars to the prompt set (excluding separators)
        for (const name of selectedVarNames) {
          if (!name.startsWith('__separator__')) {
            optionalVarsToPrompt.add(name);
          }
        }
      }
      // configureChoice === 'none' leaves optionalVarsToPrompt empty
    }
  }

  // 14. Generate configs for selected combinations
  if (jsonOutput) {
    // Output selected configs as JSON array to stdout
    const configs: MCPConfiguration[] = [];
    for (const { combination, transport } of selectedConfigs) {
      const config = await generateConfigObject({
        serverName: finalServerName,
        combination,
        transport,
        packageName,
        packageDir,
        ...(binPath !== undefined && { binPath }),
        metadata,
        metadataReader,
        httpHost,
        httpPort,
        useSource,
        quick: quickMode,
        optionalVarsToPrompt,
      });
      configs.push(config);
    }
    console.log(JSON.stringify(configs, null, 2));
  } else {
    fs.mkdirSync(outputDir, { recursive: true });

    let generatedCount = 0;
    for (const { combination, transport } of selectedConfigs) {
      const success = await generateConfigFile({
        serverName: finalServerName,
        combination,
        transport,
        outputDir,
        packageName,
        packageDir,
        ...(binPath !== undefined && { binPath }),
        metadata,
        metadataReader,
        httpHost,
        httpPort,
        useSource,
        quick: quickMode,
        optionalVarsToPrompt,
      });
      if (success) {
        generatedCount++;
      }
    }

    console.log(`\n✅ Generated ${generatedCount} config file(s) in ${outputDir}`);
  }
}

/** Exported for testing */
export function discoverServerJson(basePath = process.cwd()): string | null {
  // Check current directory
  const currentPath = path.join(basePath, 'server.json');
  if (fs.existsSync(currentPath)) {
    return currentPath;
  }

  // Check parent directory (for monorepo structure)
  const parentPath = path.join(basePath, '..', 'server.json');
  if (fs.existsSync(parentPath)) {
    return parentPath;
  }

  return null;
}

/** Exported for testing */
export function extractServerName(packageName: string): string {
  // Strip org prefix if present: "@org/package" -> "package"
  const withoutOrg = packageName.replace(/^@[^/]+\//, '');
  return withoutOrg || 'server';
}

/** Build config object (shared logic) */
async function buildServerConfig(
  params: {
    combination: Combination;
    transport: string;
    packageName: string;
    packageDir?: string;
    binPath?: string;
    metadata: ServerMetadata;
    metadataReader: Pick<MetadataReader, 'getPackageForTransport'>;
    httpHost?: string;
    httpPort?: number;
    useSource?: boolean;
    quick?: boolean; // Skip optional env var prompts, use defaults
    optionalVarsToPrompt?: Set<string>; // Filter: which optional vars to include in per-config prompting
  },
  envPromptFn: typeof promptForEnvVars = promptForEnvVars
): Promise<ServerConfig> {
  // Get package config for transport
  const transportType = params.transport === 'http' ? 'streamable-http' : 'stdio';
  const pkg = params.metadataReader.getPackageForTransport(params.metadata, transportType);

  if (!pkg) {
    throw new Error(`No ${params.transport} transport available`);
  }

  // Separate env vars and package args from dimensionValues
  const envDimensions: Record<string, string> = {};
  const argDimensions: Record<string, string> = {};

  const allPackageArgNames = (pkg.packageArguments || []).map((a) => a.name);
  for (const [key, value] of Object.entries(params.combination.dimensionValues)) {
    if (allPackageArgNames.includes(key)) {
      argDimensions[key] = value;
    } else {
      envDimensions[key] = value;
    }
  }

  // Filter environmentVariables based on combination's envKeys
  const relevantEnvVars = (pkg.environmentVariables || []).filter((envVar) => params.combination.envKeys.includes(envVar.name));

  // Filter by dependsOn - only prompt for env vars relevant to this combination's dimension values
  const envVarsMatchingDependsOn = relevantEnvVars.filter((envVar) => shouldPromptEnvVar(envVar, params.combination.dimensionValues));

  // Filter defaults to only include env vars whose dependsOn is satisfied for this combination
  // This ensures DCR_STORE_URI isn't included when AUTH_MODE=loopback-oauth, etc.
  const allEnvVars = pkg.environmentVariables || [];
  const filteredDefaults: Record<string, string> = {};
  for (const [envName, envValue] of Object.entries(params.combination.defaults)) {
    const envVarMeta = allEnvVars.find((e) => e.name === envName);
    if (!envVarMeta || shouldPromptEnvVar(envVarMeta, params.combination.dimensionValues)) {
      filteredDefaults[envName] = envValue;
    }
  }

  // Separate env vars into those with pre-populated values and those to prompt for
  const envDefaultKeys = Object.keys(filteredDefaults);
  const envDimensionKeys = Object.keys(envDimensions);
  const prePopulatedEnvKeys = [...envDefaultKeys, ...envDimensionKeys];

  // Determine which env vars to prompt for
  let envVarsToPrompt: EnvVarMetadata[];

  if (params.optionalVarsToPrompt === undefined) {
    // No filter provided (e.g., tests, non-interactive) - use old behavior: prompt all relevant vars
    envVarsToPrompt = envVarsMatchingDependsOn.filter((envVar) => !prePopulatedEnvKeys.includes(envVar.name));
  } else if (params.optionalVarsToPrompt.size === 0) {
    // Empty filter - only prompt for required vars, skip optional
    envVarsToPrompt = envVarsMatchingDependsOn.filter((envVar) => !prePopulatedEnvKeys.includes(envVar.name) && envVar.isRequired);
  } else {
    // Filter provided - prompt required vars + selected optional vars
    const requiredVars = envVarsMatchingDependsOn.filter((envVar) => !prePopulatedEnvKeys.includes(envVar.name) && envVar.isRequired);

    const selectedOptionalVars = allEnvVars.filter(
      (envVar) =>
        !envVar.isRequired && // Only optional vars
        params.optionalVarsToPrompt?.has(envVar.name) && // User selected it
        !prePopulatedEnvKeys.includes(envVar.name) && // Not already populated
        shouldPromptEnvVar(envVar, params.combination.dimensionValues) // Relevant to this config
    );

    envVarsToPrompt = [...requiredVars, ...selectedOptionalVars];
  }

  // Prompt for environment variable values using shared logic
  // In quick mode, skip prompts and use defaults/placeholders via the yes option
  const promptContext = `${params.combination.name}/${params.transport}`;

  // Build template vars for placeholder substitution (e.g., {HOST}, {PORT})
  const templateVars: Record<string, string> = {};
  if (params.httpHost) templateVars.HOST = params.httpHost;
  if (params.httpPort) templateVars.PORT = String(params.httpPort);

  const promptedEnv = await envPromptFn(promptContext, envVarsToPrompt, { yes: params.quick, templateVars });

  // Merge all env values: filtered defaults + dimension values + prompted values
  const env = { ...filteredDefaults, ...envDimensions, ...promptedEnv };

  // Build command and args based on source vs installed mode
  let command: string;
  let args: string[];

  if (params.useSource) {
    // Source mode: use node with relative path to bin entry
    if (!params.packageDir) {
      throw new Error('packageDir is required when useSource is true');
    }
    if (!params.binPath) {
      throw new Error('binPath is required when useSource is true (check package.json bin entry)');
    }
    const absolutePackageDir = path.resolve(params.packageDir);
    const relativePath = path.join(absolutePackageDir, params.binPath);
    command = 'node';
    args = [relativePath];
  } else {
    // Installed mode: use npx (current behavior)
    command = 'npx';
    args = ['-y', params.packageName];
  }

  // Add package arguments from argDefaults and argDimensions
  const allArgValues = { ...params.combination.argDefaults, ...argDimensions };
  for (const [argName, argValue] of Object.entries(allArgValues)) {
    // Named arguments are added as --arg value
    args.push(argName, argValue);
  }

  // Add HTTP-specific configuration
  if (params.transport === 'http' || params.transport === 'streamable-http') {
    const port = params.httpPort ?? 3000;
    args.push('--port', String(port));
  }

  // Build server config - structure differs for stdio vs http
  let serverConfig: ServerConfig;

  if (params.transport === 'http' || params.transport === 'streamable-http') {
    // HTTP servers use start block with stdio config structure
    const startBlock: ServerConfigStdio = {
      command,
      ...(args.length > 0 && { args }), // Only include if not empty
      ...(Object.keys(env).length > 0 && { env }), // Only include if not empty
    };

    const httpConfig: ServerConfigHttp = {
      type: 'http',
      url: `http://${params.httpHost ?? 'localhost'}:${params.httpPort ?? 3000}/mcp`,
      start: startBlock,
    };

    serverConfig = httpConfig;
  } else {
    // Stdio servers use top-level stdio config structure
    const stdioConfig: ServerConfigStdio = {
      command,
      ...(args.length > 0 && { args }), // Only include if not empty
      ...(Object.keys(env).length > 0 && { env }), // Only include if not empty
    };

    serverConfig = stdioConfig;
  }

  return serverConfig;
}

/** Generate config object (for JSON output or testing) - Exported for testing */
export async function generateConfigObject(
  params: {
    serverName: string;
    combination: Combination;
    transport: string;
    packageName: string;
    packageDir?: string;
    binPath?: string;
    metadata: ServerMetadata;
    metadataReader: Pick<MetadataReader, 'getPackageForTransport'>;
    httpHost?: string;
    httpPort?: number;
    useSource?: boolean;
    quick?: boolean;
    optionalVarsToPrompt?: Set<string>;
  },
  envPromptFn: typeof promptForEnvVars = promptForEnvVars
): Promise<MCPConfiguration> {
  const serverConfig = await buildServerConfig(params, envPromptFn);

  return {
    mcpServers: {
      [params.serverName]: serverConfig,
    },
  };
}

/** Generate config file - Exported for testing */
export async function generateConfigFile(
  params: {
    serverName: string;
    combination: Combination;
    transport: string;
    outputDir: string;
    packageName: string;
    packageDir?: string;
    binPath?: string;
    metadata: ServerMetadata;
    metadataReader: Pick<MetadataReader, 'getPackageForTransport'>;
    httpHost?: string;
    httpPort?: number;
    useSource?: boolean;
    quick?: boolean;
    optionalVarsToPrompt?: Set<string>;
  },
  envPromptFn: typeof promptForEnvVars = promptForEnvVars
): Promise<boolean> {
  // Normalize transport name for filename ('streamable-http' → 'http' to match config type)
  const transportName = params.transport === 'streamable-http' ? 'http' : params.transport;
  const filename = `.mcp.${params.combination.name}-${transportName}.json`;
  const filepath = path.join(params.outputDir, filename);

  // Check if file exists and ask user whether to overwrite
  if (fs.existsSync(filepath) && process.stdin.isTTY) {
    const shouldOverwrite = await confirm({
      message: `${filename} already exists. Overwrite?`,
      default: false,
    });

    if (!shouldOverwrite) {
      console.log(`   ⏭️  Skipped ${filename}`);
      return false;
    }
  }

  try {
    // Ensure output directory exists
    fs.mkdirSync(params.outputDir, { recursive: true });

    const config = await generateConfigObject(params, envPromptFn);
    fs.writeFileSync(filepath, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`   ✅ ${filename}`);
    return true;
  } catch (error) {
    console.error(`   ❌ ${filename}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
