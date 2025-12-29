#!/usr/bin/env node

// biome-ignore lint/security/noGlobalEval: dual esm and cjs
if (typeof require === 'undefined') eval("import('../dist/esm/cli.js').then((cli) => cli.default(process.argv.slice(2), 'mcp-z')).catch((err) => { console.log(err); process.exit(-1); });");
else require('../dist/cjs/cli.js')(process.argv.slice(2), 'mcp-z');
