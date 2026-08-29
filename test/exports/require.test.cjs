const assert = require('assert');
const { callToolCommand, getPromptCommand, inspectCommand, readResourceCommand, upCommand, validateCommand } = require('@mcp-z/cli');

describe('exports .cjs', () => {
  it('named exports resolve', () => {
    for (const fn of [callToolCommand, getPromptCommand, inspectCommand, readResourceCommand, upCommand, validateCommand]) assert.equal(typeof fn, 'function');
  });
});
