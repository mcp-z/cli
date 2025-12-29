// Base types and type guards

export {
  type Combination,
  type ConfigChoice,
  type ConfigurationMode,
  createConfigChoices,
  type Dimension,
  discoverServerJson,
  extractServerName,
  filterConfigChoices,
  generateConditionalCombinations,
  generateConfigFile,
  generateConfigObject,
  generateMatrixCombinations,
  shouldPromptEnvVar,
  TRANSPORT_MAP,
} from './commands/manifest/generate.ts';
export { type CliArgMetadata, type EnvVarMetadata, MetadataReader, type ServerMetadata } from './commands/manifest/metadata-reader.ts';

// Manifest commands
export { validateCommand } from './commands/manifest/validate.ts';
// Commands
export { upCommand } from './commands/up.ts';
// Library utilities
export { getSchema, SCHEMA_URL, validateSchema } from './lib/json-schema.ts';
export { type InlineConfigOptions, type ResolvedServerConfig, resolveServerConfig } from './lib/resolve-server-config.ts';
export * from './types.ts';
