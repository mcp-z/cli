import confirm from '@inquirer/confirm';
import input from '@inquirer/input';
import password from '@inquirer/password';
import select from '@inquirer/select';
import type { EnvVarMetadata } from './metadata-reader.ts';

/**
 * Redact sensitive values for display, showing only first 4 characters
 * Example: "sk-1234567890abcdef" -> "sk-1XXX"
 */
function redactValue(value: string, isSecret: boolean): string {
  if (!isSecret) {
    return value;
  }

  if (value.length <= 6) {
    return 'XXX';
  }

  return `${value.substring(0, 4)}XXX`;
}

/**
 * Substitute template variables in a string
 * Replaces any {VARIABLE_NAME} with the corresponding value from the variables map
 * Variable names are case-insensitive
 */
export function substituteTemplateVars(template: string | undefined, variables?: Record<string, string>): string | undefined {
  if (!template || !variables) {
    return template;
  }

  // Replace any {VARIABLE_NAME} with corresponding value from variables map
  return template.replace(/\{([^}]+)\}/g, (match, varName) => {
    // Case-insensitive lookup
    const key = Object.keys(variables).find((k) => k.toLowerCase() === varName.toLowerCase());
    return key ? variables[key] : match;
  });
}

/**
 * Get dynamic placeholder for env vars by substituting template variables
 */
function getDynamicPlaceholder(envVar: EnvVarMetadata, variables?: Record<string, string>): string | undefined {
  return substituteTemplateVars(envVar.placeholder, variables);
}

/**
 * Prompt user for environment variables with support for:
 * - Environment variable detection with partial redaction
 * - Interactive prompts for required fields
 * - Choice-based selection
 * - Password input for secrets
 * - Default values
 * - Non-interactive mode (-y flag)
 * - Dynamic placeholders via template variable substitution
 */
export async function promptForEnvVars(serverName: string, envVars: EnvVarMetadata[], options: { yes?: boolean; templateVars?: Record<string, string> } = {}): Promise<Record<string, string>> {
  const env: Record<string, string> = {};

  for (const envVar of envVars) {
    const envValue = process.env[envVar.name];
    // Support both 'default' (MCP schema standard) and 'value' (legacy) fields
    const defaultValue = envVar.default ?? envVar.value;

    if (defaultValue) {
      // Use default value from metadata if available
      env[envVar.name] = defaultValue;
    } else if (envValue && !options.yes && process.stdin.isTTY) {
      // Environment variable exists - present option with partial redaction
      const redactedValue = redactValue(envValue, envVar.isSecret);
      const useEnvChoice = `${redactedValue} (environment)`;

      if (envVar.choices && envVar.choices.length > 0) {
        // Has choices - add environment value as an option
        const choices = [useEnvChoice, ...envVar.choices, 'Enter custom value'];

        // Add skip option for optional fields
        if (!envVar.isRequired) {
          choices.push('Skip (optional)');
        }

        const message = `[${serverName}] ${envVar.name}`;

        const value = await select({
          message,
          choices,
        });

        if (value === useEnvChoice) {
          env[envVar.name] = envValue;
        } else if (value === 'Skip (optional)') {
          // Skip this optional env var - don't add to env object
        } else if (value === 'Enter custom value') {
          const promptFn = envVar.isSecret ? password : input;
          const customValue = await promptFn({
            message: `[${serverName}] ${envVar.name} (enter value)`,
            validate: (input: string) => {
              if (envVar.isRequired && (!input || input.trim() === '')) {
                return 'This field is required';
              }
              return true;
            },
          });
          env[envVar.name] = customValue as string;
        } else {
          env[envVar.name] = value as string;
        }
      } else {
        // No choices - simple confirmation or new value
        const actionChoices = [
          { name: `Use ${useEnvChoice}`, value: 'use-env' },
          { name: 'Enter new value', value: 'enter-new' },
        ];

        // Add skip option for optional fields
        if (!envVar.isRequired) {
          actionChoices.push({ name: 'Skip (optional)', value: 'skip' });
        }

        const message = `[${serverName}] ${envVar.name}`;

        const action = await select({
          message,
          choices: actionChoices,
        });

        if (action === 'use-env') {
          env[envVar.name] = envValue;
        } else if (action === 'skip') {
          // Skip this optional env var - don't add to env object
        } else {
          const promptFn = envVar.isSecret ? password : input;
          const newValue = await promptFn({
            message: `[${serverName}] ${envVar.name} (enter value)`,
            validate: (input: string) => {
              if (envVar.isRequired && (!input || input.trim() === '')) {
                return 'This field is required';
              }
              return true;
            },
          });
          env[envVar.name] = newValue as string;
        }
      }
    } else if (options.yes) {
      // -y mode: skip required vars without defaults (trust shell environment)
      if (envVar.choices && envVar.choices.length > 0 && envVar.choices[0]) {
        // Has choices - use first choice
        env[envVar.name] = envVar.choices[0];
      } else if (envVar.isRequired) {
        // Required but no default - skip with warning
        console.log(`   ⚠️  Skipping ${envVar.name}`);
      }
      // Optional vars without defaults: skip silently
    } else if (envVar.choices && envVar.choices.length > 0 && envVar.choices[0]) {
      if (process.stdin.isTTY) {
        // Interactive mode with choices - prompt user to select
        const choices = [...envVar.choices];

        // Add skip option for optional fields
        if (!envVar.isRequired) {
          choices.push('Skip (optional)');
        }

        const value = await select({
          message: `[${serverName}] ${envVar.name}`,
          choices,
        });

        if (value !== 'Skip (optional)') {
          env[envVar.name] = value as string;
        }
        // If 'Skip (optional)' selected, don't add to env object
      } else {
        // Non-interactive: use first choice
        env[envVar.name] = envVar.choices[0];
      }
    } else if (envVar.isRequired) {
      if (process.stdin.isTTY) {
        // Interactive mode - required field - prompt for value
        const promptFn = envVar.isSecret ? password : input;
        const placeholder = getDynamicPlaceholder(envVar, options.templateVars);
        const value = await promptFn({
          message: `[${serverName}] ${envVar.name} (required)`,
          ...(placeholder ? { default: placeholder } : {}),
          validate: (input: string) => {
            if (!input || input.trim() === '') {
              return 'This field is required';
            }
            return true;
          },
        });
        env[envVar.name] = value as string;
      }
      // Non-interactive without -y: skip (will fail at runtime if truly required)
    } else if (!envVar.isRequired && !options.yes && process.stdin.isTTY) {
      // Interactive mode - optional env var without defaults
      // Ask user if they want to set it
      const shouldSet = await confirm({
        message: `[${serverName}] Set optional ${envVar.name}? (${envVar.description || 'optional'})`,
        default: false,
      });

      if (shouldSet) {
        const promptFn = envVar.isSecret ? password : input;
        const placeholder = getDynamicPlaceholder(envVar, options.templateVars);
        const value = await promptFn({
          message: `[${serverName}] ${envVar.name}`,
          ...(placeholder ? { default: placeholder } : {}),
        });

        if (value && (value as string).trim() !== '') {
          env[envVar.name] = value as string;
        }
      }
    }
    // Other optional env vars are skipped
  }

  return env;
}
