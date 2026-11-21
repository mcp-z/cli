import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';

export interface ClientInfo {
  name?: string;
  version?: string;
}

export interface RecordingServer {
  url: string;
  clientInfos: ClientInfo[];
  close(): Promise<void>;
}

type Json = Record<string, unknown>;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function resultFor(method: string, params: Json): Json | undefined {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: params.protocolVersion,
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'recording-http', version: '1.0.0' },
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: [{ name: 'echo', description: 'Echo tool', inputSchema: { type: 'object', properties: {} } }] };
    case 'tools/call':
      return { content: [{ type: 'text', text: 'ok' }] };
    case 'resources/list':
      return { resources: [{ uri: 'rec://item', name: 'item', description: 'Recorded item' }] };
    case 'resources/templates/list':
      return { resourceTemplates: [] };
    case 'resources/read':
      return { contents: [{ uri: 'rec://item', mimeType: 'text/plain', text: 'item' }] };
    case 'prompts/list':
      return { prompts: [{ name: 'greet', description: 'Greeting prompt' }] };
    case 'prompts/get':
      return { messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }] };
    default:
      return undefined;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse, clientInfos: ClientInfo[]): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(req.method === 'DELETE' ? 200 : 405).end();
    return;
  }
  const message = JSON.parse(await readBody(req)) as { id?: number | string; method: string; params?: Json };
  if (message.id === undefined) {
    res.writeHead(202).end();
    return;
  }
  const params = message.params ?? {};
  if (message.method === 'initialize') clientInfos.push((params.clientInfo ?? {}) as ClientInfo);
  const result = resultFor(message.method, params);
  const body = result ? { jsonrpc: '2.0', id: message.id, result } : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } };
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

/** Plain-HTTP MCP server that records the clientInfo of every initialize request it receives. */
export async function startRecordingServer(): Promise<RecordingServer> {
  const clientInfos: ClientInfo[] = [];
  const server: Server = createServer((req, res) => {
    handle(req, res, clientInfos).catch((error) => {
      res.writeHead(500).end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    clientInfos,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
