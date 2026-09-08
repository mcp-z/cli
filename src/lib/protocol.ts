/**
 * protocol.ts
 *
 * Maps the `--protocol` CLI flag onto the MCP client's version-negotiation option
 * and turns the SDK's typed era-negotiation failure into an actionable message.
 */

import { SdkError, SdkErrorCode, type VersionNegotiationOptions } from '@mcp-z/client';

// Accepted `--protocol` values, in help-text order.
export const PROTOCOL_VALUES = ['legacy', 'auto', '2026-07-28'] as const;

export type ProtocolValue = (typeof PROTOCOL_VALUES)[number];

/**
 * Map a `--protocol` value to the SDK's version-negotiation option.
 *
 * - `undefined` (flag absent) → `undefined`: the client connects with its default,
 *   the plain 2025-era sequence.
 * - `legacy` → skip negotiation, plain 2025 connect.
 * - `auto` → probe the server first and fall back to 2025 when it cannot serve
 *   the modern revision.
 * - `2026-07-28` → require that revision; a server that cannot serve it fails
 *   the connect with a typed era-negotiation error (see `eraNegotiationError`).
 *
 * @throws Error for any value not in `PROTOCOL_VALUES`, naming the accepted ones.
 */
export function protocolToVersionNegotiation(protocol: string | undefined): VersionNegotiationOptions | undefined {
  switch (protocol) {
    case undefined:
      return undefined;
    case 'legacy':
      return { mode: 'legacy' };
    case 'auto':
      return { mode: 'auto' };
    case '2026-07-28':
      return { mode: { pin: '2026-07-28' } };
    default:
      throw new Error(`Invalid --protocol value '${protocol}'. Accepted values: ${PROTOCOL_VALUES.join(', ')}`);
  }
}

// What a pinned-2026 client against a 2025-only server should hear instead of the SDK's
// wire-level explanation.
const ERA_MISMATCH_MESSAGE = 'The server does not speak protocol revision 2026-07-28 (it did not offer it via server/discover), so a pinned connection cannot be established. Try --protocol auto to let the client probe the server and fall back to the 2025 revision, or --protocol legacy to skip negotiation entirely.';

/**
 * If `error` is the SDK's era-negotiation failure, return a friendly Error carrying the
 * same cause; otherwise return `undefined` so callers can fall through to the original.
 */
export function eraNegotiationError(error: unknown): Error | undefined {
  if (SdkError.isInstance(error) && error.code === SdkErrorCode.EraNegotiationFailed) {
    return new Error(ERA_MISMATCH_MESSAGE);
  }
  return undefined;
}
