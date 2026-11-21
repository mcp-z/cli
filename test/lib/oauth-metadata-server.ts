import * as http from 'http';
import type { AddressInfo } from 'net';

export interface OAuthMetadataServer {
  baseUrl: string;
  close: () => Promise<void>;
}

export interface OAuthMetadataServerOptions {
  /** Runs when a request for the path arrives, before the answer; stands in for another process writing the shared token file at that moment. */
  onRequest?: Record<string, () => void>;
  /** Also serve authorization and token endpoints; `/mcp` then answers 401 until it receives the bearer token `/oauth/token` issues. */
  tokenEndpoint?: boolean;
  /** The token endpoint refuses the refresh with \`invalid_grant\`, as a server does for a revoked sign-in. */
  refuseRefresh?: boolean;
}

export const SAVED_REFRESH_TOKEN = 'saved-refresh';

export const REFRESHED_ACCESS_TOKEN = 'refreshed-access';

/**
 * Local server that advertises OAuth dynamic client registration and, unless `tokenEndpoint` is
 * set, no authorize or token endpoints, so a client that finds no valid saved sign-in fails
 * without opening a browser.
 */
export default async function startOAuthMetadataServer(options: OAuthMetadataServerOptions = {}): Promise<OAuthMetadataServer> {
  let baseUrl = '';
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    options.onRequest?.[pathname]?.();
    if (pathname === '/.well-known/oauth-authorization-server') {
      res.setHeader('Content-Type', 'application/json');
      const endpoints = options.tokenEndpoint ? { authorization_endpoint: `${baseUrl}/oauth/authorize`, token_endpoint: `${baseUrl}/oauth/token`, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'] } : {};
      res.end(JSON.stringify({ issuer: baseUrl, registration_endpoint: `${baseUrl}/oauth/register`, ...endpoints }));
      return;
    }
    if (options.tokenEndpoint && pathname === '/oauth/token') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
        const valid = form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === SAVED_REFRESH_TOKEN;
        res.setHeader('Content-Type', 'application/json');
        if (options.refuseRefresh || !valid) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        res.end(JSON.stringify({ access_token: REFRESHED_ACCESS_TOKEN, token_type: 'Bearer', expires_in: 3600 }));
      });
      return;
    }
    if (options.tokenEndpoint && pathname === '/mcp' && req.headers.authorization !== `Bearer ${REFRESHED_ACCESS_TOKEN}`) {
      res.statusCode = 401;
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.end();
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
