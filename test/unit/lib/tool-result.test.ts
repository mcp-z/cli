import { ToolResponseWrapper } from '@mcp-z/client';
import assert from 'assert';
import { parseToolResult } from '../../../src/lib/tool-result.ts';

describe('unit/lib/tool-result', () => {
  describe('parseToolResult', () => {
    it('returns structured content as the result', () => {
      const response = new ToolResponseWrapper({ content: [], structuredContent: { ok: true } });
      assert.deepStrictEqual(parseToolResult(response), { ok: true });
    });

    it('returns the text of a text-only result', () => {
      const response = new ToolResponseWrapper({ content: [{ type: 'text', text: 'hello' }] });
      assert.strictEqual(parseToolResult(response), 'hello');
    });

    it('returns the content blocks of a result with no text', () => {
      const content = [{ type: 'image' as const, data: 'aGk=', mimeType: 'image/png' }];
      const response = new ToolResponseWrapper({ content });
      assert.deepStrictEqual(parseToolResult(response), content);
    });
  });
});
