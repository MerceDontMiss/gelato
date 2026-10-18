import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal, createProductHandler } from '../ecommerce.js';
import { loadConfig } from '../server.js';

const template = { id: 'template-1', variants: [{ id: 'variant-1', productUid: 'mug_uid', imagePlaceholders: [{ name: 'Artwork' }] }] };
const args = { storeId: 'store-1', templateId: 'template-1', title: 'Rain Garden', description: 'Mug', variants: [{ templateVariantId: 'variant-1', imagePlaceholders: [{ name: 'Artwork', fileUrl: 'https://art.example/design.png' }] }] };
const config = { apiKey: 'unit-key', storeIds: ['store-1'], artworkHosts: ['art.example'], writesEnabled: true };
function fixture(mode = 'ok') {
  const directory = mkdtempSync(join(tmpdir(), 'gelato-test-'));
  let posts = 0;
  const mock = async (url, init) => {
    if (init.method === 'POST') {
      posts++;
      assert.equal(init.headers['X-API-KEY'], config.apiKey);
      assert.equal(String(url), 'https://ecommerce.gelatoapis.com/v1/stores/store-1/products:create-from-template');
      const body = JSON.parse(init.body);
      assert.equal(body.isVisibleInTheOnlineStore, false);
      assert.equal(body.idempotencyKey, undefined);
      assert.equal(body.dryRun, undefined);
      assert.equal(body.variants[0].imagePlaceholders[0].fitMethod, 'meet');
      if (mode === 'timeout') throw new Error('simulated lost response');
      return Response.json({ id: 'product-1', status: 'created' });
    }
    return Response.json(String(url).includes('/templates/') ? template : { id: 'product-1', variants: [{ connectionStatus: 'connected' }] });
  };
  return { directory, mock, posts: () => posts, handler: createProductHandler(config, mock, new Journal(directory)), cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
const live = preflightHash => ({ ...args, dryRun: false, confirmCreate: true, preflightHash, idempotencyKey: 'rain-garden-operation-0001' });

test('dry-run is default, validates mapping and blocks unapproved writes', async () => {
  const f = fixture();
  try {
    const preflight = await f.handler(args);
    assert.equal(preflight.dryRun, true); assert.equal(f.posts(), 0);
    assert.equal(preflight.mapping[0].productUid, 'mug_uid');
    await assert.rejects(f.handler({ ...args, storeId: 'other' }), e => e.code === 'STORE_NOT_ALLOWED');
    await assert.rejects(f.handler({ ...args, dryRun: false }), e => e.code === 'CONFIRMATION_REQUIRED');
    const disabled = createProductHandler({ ...config, writesEnabled: false }, () => { throw Error('must not fetch'); });
    await assert.rejects(disabled(live(preflight.preflightHash)), e => e.code === 'WRITES_DISABLED');
    await assert.rejects(f.handler({ ...live(preflight.preflightHash), title: 'Changed' }), e => e.code === 'STALE_PREFLIGHT');
    for (const patch of [
      { templateVariantId: 'missing' },
      { imagePlaceholders: [{ name: 'Wrong', fileUrl: 'https://art.example/design.png' }] },
      { imagePlaceholders: [{ name: 'Artwork', fileUrl: 'http://art.example/design.png' }] },
      { imagePlaceholders: [{ name: 'Artwork', fileUrl: 'https://untrusted.example/design.png' }] },
      { imagePlaceholders: [{ name: 'Artwork', fileUrl: 'https://user:pass@art.example/design.png' }] }
    ]) await assert.rejects(f.handler({ ...args, variants: [{ ...args.variants[0], ...patch }] }));
    await assert.rejects(f.handler({ ...args, variants: [args.variants[0], args.variants[0]] }), e => e.code === 'INVALID_MAPPING');
    assert.equal(f.posts(), 0);
  } finally { f.cleanup(); }
});

test('concurrent calls and restart replay cannot send a second creation POST', async () => {
  const f = fixture();
  try {
    const { preflightHash } = await f.handler(args);
    const results = await Promise.allSettled([f.handler(live(preflightHash)), f.handler(live(preflightHash))]);
    assert.ok(results.some(r => r.status === 'fulfilled')); assert.equal(f.posts(), 1);
    const restarted = createProductHandler(config, f.mock, new Journal(f.directory));
    assert.equal((await restarted(live(preflightHash))).replayed, true);
    const changed = { ...args, title: 'Different mug' };
    const next = await restarted(changed);
    await assert.rejects(restarted({ ...live(next.preflightHash), title: changed.title }), e => e.code === 'IDEMPOTENCY_CONFLICT');
    assert.equal(f.posts(), 1);
  } finally { f.cleanup(); }
});

test('uncertain creation stays blocked across restart', async () => {
  const f = fixture('timeout');
  try {
    const { preflightHash } = await f.handler(args);
    await assert.rejects(f.handler(live(preflightHash)), e => e.code === 'RECONCILIATION_REQUIRED');
    const restarted = createProductHandler(config, f.mock, new Journal(f.directory));
    await assert.rejects(restarted(live(preflightHash)), e => e.code === 'RECONCILIATION_REQUIRED');
    assert.equal(f.posts(), 1);
  } finally { f.cleanup(); }
});

test('write configuration fails closed', () => {
  const base = { GELATO_API_KEY: 'unit-key', MCP_BEARER_TOKEN: 'test-token-'.repeat(5) };
  assert.equal(loadConfig(base).writesEnabled, false);
  assert.throws(() => loadConfig({ ...base, ENABLE_GELATO_WRITES: 'yes' }));
  assert.throws(() => loadConfig({ ...base, ENABLE_GELATO_WRITES: 'true' }));
  assert.throws(() => loadConfig({ ...base, ARTWORK_HOSTS: '*' }));
});

test('corrupt journal never authorizes another POST', async () => {
  const f = fixture();
  try {
    const { preflightHash } = await f.handler(args);
    await f.handler(live(preflightHash));
    writeFileSync(join(f.directory, readdirSync(f.directory)[0]), '{partial');
    await assert.rejects(f.handler(live(preflightHash)), e => e.code === 'RECONCILIATION_REQUIRED');
    assert.equal(f.posts(), 1);
  } finally { f.cleanup(); }
});
