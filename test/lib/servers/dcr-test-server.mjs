/**
 * Simple DCR Test Server for CLI Integration Testing
 * Provides OAuth endpoints for testing authentication flow
 */

import express from 'express';

/**
 * Start a simple DCR test server for integration testing
 * Implements minimal OAuth/DCR endpoints needed for testing
 */
export async function startDcrTestServer(config) {
  const { port, baseUrl } = config;

  // Create Express app
  const app = express();
  app.use(express.json());

  // In-memory storage for registered clients
  const clients = new Map();
  const authCodes = new Map();

  // .well-known/oauth-authorization-server endpoint (RFC 8414)
  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      registration_endpoint: `${baseUrl}/oauth/register`,
      scopes_supported: ['read', 'write'],
    });
  });

  // DCR registration endpoint (RFC 7591)
  app.post('/oauth/register', (req, res) => {
    const { client_name, redirect_uris, grant_types, response_types } = req.body;

    // Generate client credentials
    const clientId = `client_${Date.now()}`;
    const clientSecret = `secret_${Math.random().toString(36).substring(2)}`;

    // Store client
    clients.set(clientId, {
      clientId,
      clientSecret,
      redirectUris: redirect_uris || [],
    });

    res.json({
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name,
      redirect_uris,
      grant_types,
      response_types,
    });
  });

  // OAuth authorization endpoint
  app.get('/oauth/authorize', (req, res) => {
    const { client_id, redirect_uri } = req.query;

    // Validate client
    const client = clients.get(client_id);
    if (!client) {
      res.status(400).send('Invalid client_id');
      return;
    }

    // Auto-approve for testing (generate auth code)
    const authCode = `code_${Math.random().toString(36).substring(2)}`;
    authCodes.set(authCode, {
      clientId: client_id,
      redirectUri: redirect_uri,
    });

    // Redirect back to client with auth code
    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set('code', authCode);
    res.redirect(redirectUrl.toString());
  });

  // OAuth token endpoint
  app.post('/oauth/token', express.urlencoded({ extended: true }), (req, res) => {
    const { grant_type, code, refresh_token, client_id, client_secret } = req.body;

    // Validate client credentials
    const client = clients.get(client_id);
    if (!client || client.clientSecret !== client_secret) {
      res.status(401).json({ error: 'invalid_client' });
      return;
    }

    if (grant_type === 'authorization_code') {
      // Validate auth code
      const authCodeData = authCodes.get(code);
      if (!authCodeData || authCodeData.clientId !== client_id) {
        res.status(400).json({ error: 'invalid_grant' });
        return;
      }

      // Generate tokens
      authCodes.delete(code); // One-time use
      res.json({
        access_token: `access_${Math.random().toString(36).substring(2)}`,
        refresh_token: `refresh_${Math.random().toString(36).substring(2)}`,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'read write',
      });
    } else if (grant_type === 'refresh_token') {
      // For testing, accept any refresh token
      res.json({
        access_token: `access_${Math.random().toString(36).substring(2)}`,
        refresh_token,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'read write',
      });
    } else {
      res.status(400).json({ error: 'unsupported_grant_type' });
    }
  });

  // Start HTTP server
  const httpServer = await new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`🔧 DCR Test Server listening on ${baseUrl}`);
      console.log(`   .well-known: ${baseUrl}/.well-known/oauth-authorization-server`);
      resolve(server);
    });
  });

  return {
    url: baseUrl,
    close: async () => {
      httpServer.closeAllConnections();
      return new Promise((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
