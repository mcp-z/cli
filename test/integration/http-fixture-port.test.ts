// The HTTP test fixtures have no default port: without --port each must fail before binding anything.
// One file for both because bearer-auth-http has no other spec that spawns it.
import assert from 'assert';
import { spawn } from 'child_process';
import * as path from 'path';

const SERVERS = path.join(process.cwd(), 'test', 'lib', 'servers');

for (const name of ['echo-http', 'bearer-auth-http']) {
  describe(`integration/${name} fixture without --port`, () => {
    it('exits 2 with the --port message on stderr', (done) => {
      const child = spawn(process.execPath, [path.join(SERVERS, `${name}.mjs`)], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      let bound = false;
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
        if (!bound && stderr.includes('Ready on port')) {
          bound = true;
          child.kill('SIGKILL');
        }
      });
      child.on('error', done);
      child.on('close', (code) => {
        try {
          assert.ok(!bound, 'the fixture bound a port without --port');
          assert.strictEqual(code, 2);
          assert.strictEqual(stderr, `${name}: --port is required and must be a number from 1 to 65535\n`);
          done();
        } catch (err) {
          done(err as Error);
        }
      });
    });
  });
}
