import { eraNegotiationError, PROTOCOL_VALUES, protocolToVersionNegotiation } from '@mcp-z/cli';
import { SdkError, SdkErrorCode } from '@mcp-z/client';
import assert from 'assert';

describe('unit/lib/protocol', () => {
  describe('protocolToVersionNegotiation', () => {
    it('should return undefined when the flag is absent', () => {
      assert.strictEqual(protocolToVersionNegotiation(undefined), undefined);
    });

    it('should map legacy to the plain 2025 connect', () => {
      assert.deepStrictEqual(protocolToVersionNegotiation('legacy'), { mode: 'legacy' });
    });

    it('should map auto to probe-and-fallback', () => {
      assert.deepStrictEqual(protocolToVersionNegotiation('auto'), { mode: 'auto' });
    });

    it('should map 2026-07-28 to a pinned revision', () => {
      assert.deepStrictEqual(protocolToVersionNegotiation('2026-07-28'), { mode: { pin: '2026-07-28' } });
    });

    it('should reject an invalid value, naming the accepted ones', () => {
      for (const invalid of ['modern', 'AUTO', '2025-11-25']) {
        assert.throws(
          () => protocolToVersionNegotiation(invalid),
          (err: Error) => {
            assert.match(err.message, new RegExp(`Invalid --protocol value '${invalid}'`));
            assert.match(err.message, /Accepted values:/);
            for (const value of PROTOCOL_VALUES) {
              assert.ok(err.message.includes(value), `message should name accepted value ${value}`);
            }
            return true;
          }
        );
      }
    });
  });

  describe('eraNegotiationError', () => {
    it('should translate the SDK era-negotiation failure into a friendly error', () => {
      const sdkError = new SdkError(SdkErrorCode.EraNegotiationFailed, 'Version negotiation failed: the server did not offer pinned protocol version 2026-07-28');
      const friendly = eraNegotiationError(sdkError);

      assert.ok(friendly instanceof Error);
      assert.match(friendly.message, /does not speak protocol revision 2026-07-28/);
      assert.match(friendly.message, /--protocol auto/);
      assert.match(friendly.message, /--protocol legacy/);
    });

    it('should pass through other SdkError codes', () => {
      const other = new SdkError(SdkErrorCode.InvalidResult, 'Invalid result');
      assert.strictEqual(eraNegotiationError(other), undefined);
    });

    it('should pass through plain errors and non-errors', () => {
      assert.strictEqual(eraNegotiationError(new Error('server not running')), undefined);
      assert.strictEqual(eraNegotiationError('a string'), undefined);
      assert.strictEqual(eraNegotiationError(undefined), undefined);
    });
  });
});
