import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp, loadConfig } from '../server.js';
import { requestGelato } from '../gelato.js';

const token = 'test-token-'.repeat(5);
const config = loadConfig({ GELATO_API_KEY: 'unit-test-key-only', MCP_BEARER_TOKEN: token });
test('startup fails closed without separate valid credentials', () => {
  assert.throws(() => loadConfig({}));
  assert.throws(() => loadConfig({ GELATO_API_KEY: token, MCP_BEARER_TOKEN: token }));
  assert.throws(() => loadConfig({ GELATO_API_KEY: 'x', MCP_BEARER_TOKEN: 'short' }));
  assert.throws(() => loadConfig({ GELATO_API_KEY: 'x', MCP_BEARER_TOKEN: token, PORT: 'abc' }));
});
test('HTTP security, MCP handshake and every read-only tool', async () => {
  const calls = [];
  const listener = createApp(config, async (url, init) => {
    calls.push({ url: String(url), ...init });
    return Response.json({ fixture: true });
  }).listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const base = `http://127.0.0.1:${listener.address().port}`;
  const auth = { Authorization: `Bearer ${token}` };
  const client = new Client({ name: 'starter-integration-test', version: '1.0.0' });
  try {
    assert.equal((await fetch(base + '/health')).status, 200);
    for (const method of ['GET', 'POST', 'DELETE']) assert.equal((await fetch(base + '/mcp', { method })).status, 401);
    assert.equal((await fetch(base + '/mcp', { headers: { ...auth, Origin: 'https://evil.example' } })).status, 403);
    const badHostStatus = await new Promise((resolve, reject) => {
      const req = request(base + '/mcp', { headers: { ...auth, Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(badHostStatus, 403);
    assert.equal((await fetch(base + '/mcp', { headers: auth })).status, 405);
    assert.equal((await fetch(base + '/mcp', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{' })).status, 400);
    assert.equal((await fetch(base + '/mcp', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'x'.repeat(66000) }) })).status, 413);
    await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: auth } }));
    const { tools } = await client.listTools();
    assert.equal(tools.length, 7);
    assert.ok(tools.every(t => t.annotations.readOnlyHint && !t.annotations.destructiveHint));
    const cases = [
      ['gelato_list_catalogs', {}, 'GET', 'https://product.gelatoapis.com/v3/catalogs'],
      ['gelato_get_catalog', { catalogUid: 'posters' }, 'GET', 'https://product.gelatoapis.com/v3/catalogs/posters'],
      ['gelato_search_products', { catalogUid: 'posters', attributeFilters: { Orientation: ['hor'] }, limit: 2, offset: 0 }, 'POST', 'https://product.gelatoapis.com/v3/catalogs/posters/products:search'],
      ['gelato_get_product', { productUid: 'verified_uid' }, 'GET', 'https://product.gelatoapis.com/v3/products/verified_uid'],
      ['gelato_get_prices', { productUid: 'verified_uid', country: 'US', currency: 'USD', pageCount: 20 }, 'GET', 'https://product.gelatoapis.com/v3/products/verified_uid/prices?country=US&currency=USD&pageCount=20'],
      ['gelato_shipping_methods', { country: 'US' }, 'GET', 'https://shipment.gelatoapis.com/v1/shipment-methods?country=US'],
      ['gelato_shipping_prices', { country: 'US', currency: 'USD', hasTracking: true, products: [{ productUid: 'verified_uid', quantities: [1, 5], pageCount: 20 }] }, 'POST', 'https://shipment.gelatoapis.com/v1/prices:search']
    ];
    for (const [name, args, method, url] of cases) {
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError); assert.equal(JSON.parse(result.content[0].text).data.fixture, true);
      const call = calls.at(-1); assert.equal(call.method, method); assert.equal(call.url, url);
      assert.equal(call.headers['X-API-KEY'], config.apiKey); assert.equal(call.redirect, 'error');
      if (method === 'POST') { const { catalogUid, ...body } = args; assert.deepEqual(JSON.parse(call.body), body); }
    }
    const before = calls.length;
    for (const args of [{ catalogUid: '../orders' }, { catalogUid: 'posters', limit: 101 }]) {
      const result = await client.callTool({ name: 'gelato_search_products', arguments: args }); assert.equal(result.isError, true);
    }
    const unknown = await client.callTool({ name: 'gelato_create_order', arguments: {} }); assert.equal(unknown.isError, true);
    assert.equal(calls.length, before);
  } finally { await client.close(); listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); }
});
test('upstream failures are explicit and never expose raw bodies or credentials', async () => {
  const route = ['GET', 'https://product.gelatoapis.com/v3/catalogs'];
  for (const status of [400, 401, 403, 404, 429, 500, 503]) {
    await assert.rejects(requestGelato(route, config.apiKey, async () => new Response(config.apiKey, { status })), e => e.status === status && !e.message.includes(config.apiKey));
  }
  await assert.rejects(requestGelato(route, config.apiKey, async () => { throw new Error(config.apiKey); }), e => e.code === 'GELATO_NETWORK_ERROR');
  await assert.rejects(requestGelato(route, config.apiKey, async () => new Response('invalid')), e => e.code === 'INVALID_RESPONSE');
  await assert.rejects(requestGelato(route, config.apiKey, async () => new Response('x'.repeat(2000001))), e => e.code === 'RESPONSE_TOO_LARGE');
  const redacted = await requestGelato(route, config.apiKey, async () => Response.json({ echo: config.apiKey }));
  assert.equal(redacted.echo, '[REDACTED]');
});
test('authenticated rate limit bounds requests without contacting Gelato', async () => {
  const listener = createApp(config, async () => { throw new Error('must not fetch'); }).listen(0, '127.0.0.1');
  await once(listener, 'listening');
  try {
    const url = `http://127.0.0.1:${listener.address().port}/mcp`;
    for (let i = 0; i < 120; i++) assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).status, 405);
    const limited = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '60');
  } finally { listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); }
});
