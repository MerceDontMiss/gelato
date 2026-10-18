import { createHash } from 'node:crypto';
import { openSync, closeSync, writeSync, fsyncSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { GelatoError, requestGelato } from './gelato.js';

const id = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/);
export const createShape = {
  storeId: id, templateId: id,
  title: z.string().min(1).max(140), description: z.string().min(1).max(10000),
  variants: z.array(z.object({
    templateVariantId: id,
    imagePlaceholders: z.array(z.object({
      name: z.string().min(1).max(200), fileUrl: z.string().url().max(2048),
      fitMethod: z.enum(['slice', 'meet']).default('meet')
    }).strict()).min(1).max(20)
  }).strict()).min(1).max(100),
  dryRun: z.boolean().default(true),
  confirmCreate: z.boolean().default(false),
  preflightHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  idempotencyKey: z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/).optional()
};
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail = (code, message) => { throw new GelatoError(code, message); };

// Each key is claimed with an exclusive, fsynced file BEFORE the upstream POST.
// Never delete pending/corrupt records automatically: a lost response may mean success.
export class Journal {
  constructor(directory) { this.directory = directory; mkdirSync(directory, { recursive: true, mode: 0o700 }); }
  claim(key, fingerprint) {
    const path = join(this.directory, hash(key) + '.jsonl');
    let fd;
    try { fd = openSync(path, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let rows;
      try { rows = readFileSync(path, 'utf8').trim().split('\n').map(x => JSON.parse(x)); }
      catch { fail('RECONCILIATION_REQUIRED', 'Journal is incomplete. Reconcile in Gelato; do not retry with another key.'); }
      if (rows[0].fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', 'This key belongs to different product arguments.');
      const last = rows.at(-1);
      if (last.state !== 'complete' || !last.productId) fail('RECONCILIATION_REQUIRED', 'Previous attempt may have created a product. Inspect Gelato before any further creation.');
      return { productId: last.productId };
    }
    try { writeSync(fd, JSON.stringify({ state: 'pending', fingerprint }) + '\n'); fsyncSync(fd); }
    finally { closeSync(fd); }
    // Persist the directory entry too on Linux (Render); Windows has no directory fsync.
    if (process.platform !== 'win32') {
      const directoryFd = openSync(this.directory, 'r');
      try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
    }
    return { path };
  }
  complete(path, productId) {
    const fd = openSync(path, 'a');
    try { writeSync(fd, JSON.stringify({ state: 'complete', productId }) + '\n'); fsyncSync(fd); }
    finally { closeSync(fd); }
  }
}

export function createProductHandler(config, fetchImpl, journal) {
  return async input => {
    const a = z.object(createShape).strict().parse(input);
    if (!config.storeIds?.includes(a.storeId)) fail('STORE_NOT_ALLOWED', 'Configure GELATO_STORE_IDS with this verified connected store ID.');
    const { storeId, dryRun, confirmCreate, preflightHash, idempotencyKey, ...fields } = a;
    const body = { ...fields, isVisibleInTheOnlineStore: false };
    const fingerprint = hash({ storeId, body });
    const getProduct = productId => requestGelato(['GET', `https://ecommerce.gelatoapis.com/v1/stores/${encodeURIComponent(storeId)}/products/${encodeURIComponent(productId)}`], config.apiKey, fetchImpl);
    // Reject disabled or unconfirmed live calls before contacting Gelato.
    if (!dryRun && (!config.writesEnabled || !journal)) fail('WRITES_DISABLED', 'Live creation requires ENABLE_GELATO_WRITES=true and a persistent IDEMPOTENCY_DIR.');
    if (!dryRun && (!confirmCreate || !preflightHash || !idempotencyKey)) fail('CONFIRMATION_REQUIRED', 'Supply confirmCreate=true, the dry-run preflightHash and a stable idempotencyKey. Creation may trigger store publishing work.');
    const template = await requestGelato(['GET', `https://ecommerce.gelatoapis.com/v1/templates/${encodeURIComponent(a.templateId)}`], config.apiKey, fetchImpl);
    const seen = new Set();
    for (const variant of a.variants) {
      if (seen.has(variant.templateVariantId)) fail('INVALID_MAPPING', 'Duplicate template variant.');
      seen.add(variant.templateVariantId);
      const source = template.variants?.find(v => v.id === variant.templateVariantId);
      if (!source?.productUid) fail('INVALID_MAPPING', 'Variant is absent from template or has no productUid.');
      const placeholders = source.imagePlaceholders || [];
      const names = variant.imagePlaceholders.map(p => p.name);
      if (new Set(names).size !== names.length || names.length !== placeholders.length || placeholders.some(p => !names.includes(p.name))) fail('INVALID_MAPPING', 'Supply each template artwork placeholder exactly once.');
      for (const p of variant.imagePlaceholders) {
        const url = new URL(p.fileUrl);
        if (url.protocol !== 'https:' || url.username || url.password || url.port || !config.artworkHosts?.includes(url.hostname.toLowerCase())) fail('ARTWORK_NOT_ALLOWED', 'Use an HTTPS artwork URL on an exact ARTWORK_HOSTS allowlist hostname, without credentials or custom ports.');
      }
    }
    const currentHash = hash({ fingerprint, template });
    if (dryRun) return {
      dryRun: true, preflightHash: currentHash, liveCreationEnabled: Boolean(config.writesEnabled),
      storeId, templateId: a.templateId,
      mapping: a.variants.map(v => ({ templateVariantId: v.templateVariantId, productUid: template.variants.find(t => t.id === v.templateVariantId).productUid })),
      isVisibleInTheOnlineStore: false,
      limitations: ['No artwork download or print-quality validation performed.', 'No price, shipping, profit or publication approval implied.', 'Does not link an existing Etsy listing or verify SKU/fulfillment sync.', 'Live creation can trigger background store publishing work; false visibility is not a universal draft guarantee.']
    };
    if (preflightHash !== currentHash) fail('STALE_PREFLIGHT', 'Template or arguments changed. Run dry-run again.');
    const claimed = journal.claim(idempotencyKey, fingerprint);
    if (claimed.productId) return { replayed: true, data: await getProduct(claimed.productId) };
    try {
      const data = await requestGelato(['POST', `https://ecommerce.gelatoapis.com/v1/stores/${encodeURIComponent(storeId)}/products:create-from-template`, body], config.apiKey, fetchImpl);
      if (typeof data.id !== 'string' || !id.safeParse(data.id).success) fail('INVALID_RESPONSE', 'Creation returned no valid product ID.');
      journal.complete(claimed.path, data.id);
      return { replayed: false, data, fulfillmentVerified: false };
    } catch {
      fail('RECONCILIATION_REQUIRED', 'Creation outcome is uncertain or rejected. Key remains blocked. Inspect Gelato and reconcile before creating again; never automatically retry with a new key.');
    }
  };
}
