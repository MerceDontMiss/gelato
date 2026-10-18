import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { definitions, requestGelato } from './gelato.js';

export function loadConfig(env = process.env) {
  const apiKey = env.GELATO_API_KEY?.trim(); const token = env.MCP_BEARER_TOKEN?.trim();
  if (!apiKey || /[\r\n]/.test(apiKey)) throw new Error('Set a valid GELATO_API_KEY.');
  if (!token || !/^[A-Za-z0-9_-]{32,256}$/.test(token) || token === apiKey) throw new Error('Set a separate MCP_BEARER_TOKEN: 32-256 URL-safe characters.');
  const port = Number(env.PORT || 10000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  const hosts = (env.ALLOWED_HOSTS || 'localhost,127.0.0.1').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (env.RENDER_EXTERNAL_HOSTNAME) hosts.push(env.RENDER_EXTERNAL_HOSTNAME.toLowerCase());
  return { apiKey, token, port, hosts, origins: (env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean) };
}
const id = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/);
const country = z.string().regex(/^[A-Z]{2}$/); const currency = z.string().regex(/^[A-Z]{3}$/);
const schemas = {
  id, country, currency, countryOptional: country.optional(), currencyOptional: currency.optional(),
  pageCount: z.number().int().min(1).max(10000).optional(), bool: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(1000000).default(0),
  filters: z.record(z.string().min(1).max(100), z.array(z.string().min(1).max(200)).min(1).max(50)).refine(x => Object.keys(x).length <= 50).optional(),
  products: z.array(z.object({ productUid: id, quantities: z.array(z.number().int().min(1).max(1000000)).min(1).max(20), pageCount: z.number().int().min(1).max(10000).optional() }).strict()).min(1).max(20)
};
export function createApp(config, fetchImpl = fetch) {
  const app = express(); app.disable('x-powered-by');
  app.use((req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); next(); });
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'gelato-readonly-mcp' }));
  const digest = value => createHash('sha256').update(value).digest();
  let windowStart = Date.now(), count = 0, active = 0;
  app.use('/mcp', (req, res, next) => {
    if (!timingSafeEqual(digest(req.headers.authorization || ''), digest(`Bearer ${config.token}`))) {
      res.set('WWW-Authenticate', 'Bearer realm="gelato-mcp"'); return res.status(401).json({ error: 'Unauthorized' });
    }
    let hostname;
    try { hostname = new URL(`http://${req.headers.host}`).hostname.toLowerCase(); } catch { return res.status(403).json({ error: 'Invalid host' }); }
    if (!config.hosts.includes(hostname)) return res.status(403).json({ error: 'Host not allowed' });
    if (req.headers.origin && !config.origins.includes(req.headers.origin)) return res.status(403).json({ error: 'Origin not allowed' });
    if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); count = 0; }
    if (++count > 120 || active >= 10) { res.set('Retry-After', '60'); return res.status(429).json({ error: 'Server busy; retry later' }); }
    next();
  });
  app.post('/mcp', express.json({ limit: '64kb' }), async (req, res) => {
    active++;
    const server = new McpServer({ name: 'gelato-readonly', version: '1.0.0' });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    let cleaned = false;
    const cleanup = () => { if (cleaned) return; cleaned = true; active--; void transport.close(); void server.close(); };
    res.on('close', cleanup);
    for (const [name, description, fields, build] of definitions) {
      const shape = Object.fromEntries(Object.entries(fields).map(([key, type]) => [key, schemas[type]]));
      server.registerTool(name, { description, inputSchema: shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } }, async args => {
        try {
          const parsed = z.object(shape).strict().parse(args);
          const data = await requestGelato(build(parsed), config.apiKey, fetchImpl);
          return { content: [{ type: 'text', text: JSON.stringify({ data, retrievedAt: new Date().toISOString() }) }] };
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: error.code || 'INVALID_INPUT', message: error.code ? error.message : 'Invalid tool arguments.', ...(error.status ? { upstreamStatus: error.status } : {}) }) }] };
        }
      });
    }
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch { if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal MCP error' } }); }
  });
  app.all('/mcp', (_req, res) => res.set('Allow', 'POST').status(405).json({ error: 'Use Streamable HTTP POST; standalone SSE and sessions are not supported.' }));
  app.use((err, _req, res, _next) => res.status(err.type === 'entity.too.large' ? 413 : 400).json({ error: 'Invalid or oversized JSON request' }));
  return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = loadConfig(); const listener = createApp(config).listen(config.port, '0.0.0.0', () => console.log(`Gelato MCP listening on port ${config.port}`));
    listener.requestTimeout = 30000; listener.headersTimeout = 15000;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { listener.close(() => process.exit(0)); setTimeout(() => process.exit(0), 25000).unref(); });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
