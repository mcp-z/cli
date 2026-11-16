import { ToolResponseError, type ToolResponseWrapper } from '@mcp-z/client';

/**
 * Reduce a successful tool response to the value the CLI prints.
 * Structured JSON wins, then text, then the raw content blocks; error responses are rethrown.
 */
export function parseToolResult(response: ToolResponseWrapper): unknown {
  try {
    return response.json();
  } catch (error) {
    if (error instanceof ToolResponseError) {
      if ('isError' in error.response && error.response.isError) {
        throw error;
      }
      try {
        return response.text();
      } catch (textError) {
        // No text block (image or resource content only): print the content rather than nothing
        if (textError instanceof ToolResponseError) return response.toJSON().content;
        throw textError;
      }
    }
    throw error;
  }
}
