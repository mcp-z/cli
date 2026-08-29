import { callToolCommand, getPromptCommand, inspectCommand, readResourceCommand, upCommand, validateCommand } from '@mcp-z/cli';
import assert from 'assert';

describe('exports .ts', () => {
  it('named exports resolve', () => {
    for (const fn of [callToolCommand, getPromptCommand, inspectCommand, readResourceCommand, upCommand, validateCommand]) assert.equal(typeof fn, 'function');
  });
});
