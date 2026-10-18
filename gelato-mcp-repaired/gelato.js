// Fixed route table: callers cannot supply URLs or choose arbitrary HTTP operations.
export const definitions = [
  ['gelato_get_template', 'Read a dashboard-created template, variant IDs, product UIDs and artwork placeholders. Does not read Etsy SKUs.', { templateId: 'id' }, a => ['GET', `https://ecommerce.gelatoapis.com/v1/templates/${encodeURIComponent(a.templateId)}`]],
  ['gelato_list_store_products', 'List products in a known connected store. Does not connect a store or link an existing Etsy listing.', { storeId: 'id', limit: 'limit', offset: 'offset' }, ({ storeId, ...query }) => ['GET', `https://ecommerce.gelatoapis.com/v1/stores/${encodeURIComponent(storeId)}/products`, undefined, query]],
  ['gelato_get_store_product', 'Read store/external product and variant IDs, productUid and connectionStatus. No documented SKU field; no fulfillment guarantee.', { storeId: 'id', productId: 'id' }, a => ['GET', `https://ecommerce.gelatoapis.com/v1/stores/${encodeURIComponent(a.storeId)}/products/${encodeURIComponent(a.productId)}`]],
  ['gelato_list_catalogs', 'List Gelato manufacturing catalogs.', {}, () => ['GET', 'https://product.gelatoapis.com/v3/catalogs']],
  ['gelato_get_catalog', 'Get catalog attributes; use returned IDs for product filters.', { catalogUid: 'id' }, a => ['GET', `https://product.gelatoapis.com/v3/catalogs/${encodeURIComponent(a.catalogUid)}`]],
  ['gelato_search_products', 'Search a manufacturing catalog. POST is a read-only search, not a product creation.', { catalogUid: 'id', attributeFilters: 'filters', limit: 'limit', offset: 'offset' }, ({ catalogUid, ...body }) => ['POST', `https://product.gelatoapis.com/v3/catalogs/${encodeURIComponent(catalogUid)}/products:search`, body]],
  ['gelato_get_product', 'Get manufacturing product specifications by verified productUid; this is not a connected store listing.', { productUid: 'id' }, a => ['GET', `https://product.gelatoapis.com/v3/products/${encodeURIComponent(a.productUid)}`]],
  ['gelato_get_prices', 'Get quantity price tiers. Supply country and currency to avoid ambiguous prices; pageCount is required by Gelato for multipage products. Not a final order quote.', { productUid: 'id', country: 'countryOptional', currency: 'currencyOptional', pageCount: 'pageCount' }, ({ productUid, ...query }) => ['GET', `https://product.gelatoapis.com/v3/products/${encodeURIComponent(productUid)}/prices`, undefined, query]],
  ['gelato_shipping_methods', 'List shipping methods, optionally filtered by destination country.', { country: 'countryOptional' }, query => ['GET', 'https://shipment.gelatoapis.com/v1/shipment-methods', undefined, query]],
  ['gelato_shipping_prices', 'Search country-level shipping price estimates for products and quantities. Minimum/average prices are estimates, not an address-specific quote or a combined basket total. Does not create an order.', { country: 'country', currency: 'currency', products: 'products', isBusiness: 'bool', isPrivate: 'bool', hasTracking: 'bool' }, body => ['POST', 'https://shipment.gelatoapis.com/v1/prices:search', body]]
];

export class GelatoError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}
export async function requestGelato(route, apiKey, fetchImpl = fetch) {
  const [method, base, body, query = {}] = route;
  const url = new URL(base);
  for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
  try {
    const response = await fetchImpl(url, {
      method, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { 'X-API-KEY': apiKey, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) {
      await response.body?.cancel();
      const messages = { 400: 'Gelato rejected the parameters. Check product UID, country, currency and pageCount.', 401: 'Gelato API key was rejected. Check GELATO_API_KEY in Render.', 403: 'Gelato denied access. Check API account permissions.', 404: 'Gelato resource or endpoint was not found.', 429: 'Gelato rate limit reached. Wait before retrying.' };
      throw new GelatoError('GELATO_HTTP_ERROR', messages[response.status] || 'Gelato is unavailable or rejected this request. Retry later or consult Gelato support.', response.status);
    }
    const reader = response.body.getReader();
    let size = 0; const chunks = [];
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length;
        if (size > 2_000_000) { await reader.cancel(); throw new GelatoError('RESPONSE_TOO_LARGE', 'Gelato response exceeded 2 MB. Narrow filters or reduce search limit.'); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    try {
      // Strip accidentally echoed secrets even on a successful upstream response.
      return JSON.parse(Buffer.concat(chunks).toString('utf8').split(apiKey).join('[REDACTED]'));
    } catch { throw new GelatoError('INVALID_RESPONSE', 'Gelato returned invalid JSON.'); }
  } catch (error) {
    if (error instanceof GelatoError) throw error;
    throw new GelatoError('GELATO_NETWORK_ERROR', 'Gelato connection failed or timed out; redirects are refused.');
  }
}
