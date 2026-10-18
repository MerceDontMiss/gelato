# Gelato MCP repair

The repository root is now the deployable application. The older `gelato-mcp-starter/`
folder is a historical duplicate, excluded from the Docker image and root test command.
Set Render Root Directory to blank, not that subfolder. The supplied ZIP contains only
the canonical root application. Keep the existing service name and bearer token.

## What changed

The original seven manufacturing/product/pricing/shipping reads are preserved unchanged.
Added `gelato_get_template`, `gelato_list_store_products`, `gelato_get_store_product`,
and `gelato_create_product_from_template` (dry-run by default). Discovery returns 11 tools.
Root tests, CI, Blueprint and ignore files are provided; the original root check command
referenced a test file which was only present in the duplicated starter folder.

## What Gelato publicly documents

Verified October 18, 2026 against official documentation:

| Tool | Route on https://ecommerce.gelatoapis.com | Source |
| --- | --- | --- |
| gelato_get_template | GET /v1/templates/{templateId} | [Template](https://dashboard.gelato.com/docs/ecommerce/templates/get/) |
| gelato_list_store_products | GET /v1/stores/{storeId}/products | [List](https://dashboard.gelato.com/docs/ecommerce/products/list/) |
| gelato_get_store_product | GET /v1/stores/{storeId}/products/{productId} | [Get](https://dashboard.gelato.com/docs/ecommerce/products/get/) |
| gelato_create_product_from_template | POST /v1/stores/{storeId}/products:create-from-template | [Create](https://dashboard.gelato.com/docs/ecommerce/products/create-from-template/) |

1. **Manufacturing product UID:** the printable item specification. It is neither an Etsy
   SKU nor a listing ID. Catalog discovery establishes available products, not a store link.
2. **Gelato template:** saved in Gelato dashboard with variants, print image placeholders,
   prices and mockups. Get Template supplies template variant IDs and productUid mappings.
   This is distinct from print specifications/print-area dimensions. No API for creating a
   template is invented here. [Setup guide](https://dashboard.gelato.com/docs/guides/create-product-from-template/).
3. **Store product/variant:** Get Store Product exposes internal IDs, external IDs,
   productUid and variant connectionStatus. The documented schema exposes no SKU field;
   externalId and productUid must never be relabeled as SKU.
4. **Etsy fulfillment sync:** requires the actual Etsy integration and connected variants.
   The public create endpoint creates a new store product; it does not document attaching
   an arbitrary existing Etsy listing. No link-existing, SKU-write, connect-store or sync
   endpoint is invented. Account-specific API access and Etsy behavior remain untested.
   Gelato documents [initial Etsy authorization](https://support.gelato.com/en/articles/8996451-how-to-connect-my-etsy-store-to-gelato)
   and [existing listing connection](https://support.gelato.com/en/articles/8996473-how-do-i-connect-individual-etsy-listings-to-gelato)
   in its dashboard. Use that supported workflow for existing listings; then inspect the
   connection with the read tools. [Avoid changing connected SKUs](https://support.gelato.com/en/articles/8996485-can-i-change-the-sku-value-for-my-listings-on-etsy).

No documented upstream idempotency key is asserted. The server implements a local durable
attempt journal and never automatically retries creation. `isVisibleInTheOnlineStore` is
forced false, but creation itself may start asynchronous publishing work. Do not treat
this flag as a universal no-publication guarantee. Initial status `created` or a successful
HTTP response does not prove external publication or fulfillment sync.

## Deploy/update Render

1. Upload the ZIP's contents to the repository root, replacing matching files, and commit.
   Include dotfiles, `test/` and `.github/workflows/ci.yml`. Do not upload `node_modules`,
   real `.env` files, or journal data. No credentials belong in GitHub.
2. In the existing Render service, use repository root and its Dockerfile. Preserve existing
   secret values for `GELATO_API_KEY` and `MCP_BEARER_TOKEN`. The latter remains a separate
   32-256 character URL-safe token; Gelato requests still use `X-API-KEY`.
3. Set `ENABLE_GELATO_WRITES=false`. Set `GELATO_STORE_IDS` to a comma-separated list of
   verified connected store IDs (from the dashboard URL). Set `ARTWORK_HOSTS` to exact,
   trusted public artwork CDN hostnames. No schemes, paths or wildcards. Prefer CDN hosts
   you control. The server validates URL structure/host only; it does not fetch artwork,
   verify file MIME, follow redirects, or certify print quality. Host allowlisting cannot
   guarantee the remote CDN's redirects/content or how Gelato fetches a URL.
4. Wait for CI, then deploy the latest commit. The Blueprint is for a free read/preflight
   service; if updating manually, apply the new environment settings yourself. Do not
   accidentally create a second production service. Render supplies PORT and its hostname.
5. Open `https://YOUR-SERVICE.onrender.com/health`. Existing health identity is preserved:
   `{"status":"ok","service":"gelato-readonly-mcp"}`. It checks liveness only.
6. Verify the ten read tools and a creation dry-run before considering live creation.

Optional live creation, only after approving the specific product and its possible store
side effects: provision a **paid service with a persistent disk** mounted at `/app/data`.
Ensure the non-root Docker `node` user can write it. Set `IDEMPOTENCY_DIR=/app/data` and
`ENABLE_GELATO_WRITES=true`, then redeploy. Update Blueprint plan/disk settings if managing
the service through Blueprint; the supplied Blueprint deliberately leaves writes off.
The server requires a path but cannot detect whether the operator actually mounted a
persistent disk. **An ordinary ephemeral directory is not sufficient.** Run one instance
with this disk; independent replicas/disks do not share duplicate protection.
[Render storage documentation](https://render.com/docs/disks).

Use persistent-disk backups. Do not delete, reset, roll back or replace the journal while
continuing live operations: lost records remove duplicate protection. The journal records
only hashes, pending/completed states and returned Gelato product IDs, not artwork URLs
or credentials. Retain it for the life of the operation keys. Before schema/SDK upgrades,
run `npm ci --ignore-scripts`, `npm run check`, `npm test` and the Docker build.

## StarNet

In **TOOLSETS & CONNECTORS → MCP CONNECTORS**, update the existing remote connector:

- Endpoint: `https://YOUR-SERVICE.onrender.com/mcp`.
- Transport: Streamable HTTP; this server is stateless and POST-only, not legacy SSE.
- Bearer token: the existing `MCP_BEARER_TOKEN` (not the Gelato API key).
- Reconnect/refresh discovery: expect all seven old names plus the four new names above.

The header must be `Authorization: Bearer <token>`. Keep the secret in StarNet's protected
token field. Use exact ALLOWED_HOSTS for custom domains; if your client sends Origin, set
ALLOWED_ORIGINS to the exact trusted origin, without wildcards. No Origin is needed for a
server client. Never add header/body logging. All token holders share the same permissions,
including live creation if enabled; restrict connector access accordingly.
[Official StarNet connector instructions](https://starnetos.com/docs/connect-a-platform).
This package is locally tested with the official MCP client; your authenticated StarNet
and Render sessions were not available, so a live end-to-end deployment is not claimed.

## Rain Garden workflow

1. In Gelato dashboard connect/authorize the Etsy store, and create the mug template with
   the intended variants, mockups and prices. Copy the actual template/store IDs.
2. Call `gelato_get_template` with `templateId`. Select returned variant IDs and copy
   exact image placeholder names. Do not use a guessed mug SKU or just catalog `mugs`.
3. Call `gelato_list_store_products` with `storeId`, `limit` and `offset`; page as needed.
   For an existing Etsy listing, connect/match its variants in Gelato dashboard instead
   of calling create. Use `gelato_get_store_product` to inspect the result.
4. For a genuinely new product, call `gelato_create_product_from_template` like this,
   substituting verified values:

```json
{
  "storeId": "RETURNED_STORE_ID",
  "templateId": "RETURNED_TEMPLATE_ID",
  "title": "Rain Garden Mug",
  "description": "Approved product description",
  "variants": [{
    "templateVariantId": "RETURNED_VARIANT_ID",
    "imagePlaceholders": [{
      "name": "EXACT_TEMPLATE_PLACEHOLDER",
      "fileUrl": "https://YOUR-ALLOWLISTED-CDN/design.png",
      "fitMethod": "meet"
    }]
  }],
  "dryRun": true
}
```

Supply exactly every artwork placeholder for each selected variant. Only explicitly
selected variants are created. `meet` preserves the whole artwork; `slice` crops to fill.
Dry-run performs only Get Template and returns mapping, limitations and preflightHash.
It does not reserve a product, inspect artwork bytes, approve pricing, or change a store.

5. Keep QA, Finance and publication decisions separate. Existing price/shipping reads are
   estimates/tiers; they do not establish all taxes, Etsy fees, address-specific costs or
   profit. No PRICED_PASS or VALIDATION_PASS is manufactured by this server.
6. Only after explicit human approval and live-write configuration, repeat the identical
   request with `dryRun:false`, `confirmCreate:true`, the returned `preflightHash`, and a
   stable unique `idempotencyKey` of 16-128 URL-safe characters. Reuse that exact key for
   all retries of this business operation. Never use a fresh key merely to bypass a block.
   Changed arguments or template data require another preflight. A preflight hash is a
   change check, not proof of human approval; confirmCreate is a caller attestation.
7. Poll Get Store Product with the returned ID at a reasonable interval; inspect status,
   externalId, publishingErrorCode and each variant's connectionStatus. Then verify the
   Etsy listing/variant/SKU mapping and integration settings in the dashboards. Do not
   place a production order to test this package. No order creation tool exists.

## Duplicate protection and recovery

The first live attempt exclusively claims and fsyncs its key on disk before POST. Another
concurrent attempt cannot POST with that key. Completed retries read the recorded product;
they do not create another one. A reused key with different arguments is rejected.
Template changes can require a fresh preflight even when replaying a completed operation.
The journal does not detect duplicate intent under different keys; keep one stable key
per business operation in Commander. Multi-host distributed idempotency is not implemented.

Timeouts, rejected HTTP responses, malformed creation responses, or local journal-write
failures leave the key blocked as RECONCILIATION_REQUIRED. This deliberately favors review
over risking another product. Do not automatically clear pending files, even after a
restart. Read/list products and inspect the dashboard to determine the outcome. If the
product exists, use its verified ID and stop creation. If no product is conclusively
created, an operator must review and authorize a new operation/key. There is no automatic
reconciliation or forced-unlock tool and no unverified upstream retry guarantee.

## Local verification

Node 22+, `npm ci --ignore-scripts`, `npm run check`, `npm test`.
For local use copy `.env.example` to `.env`, set secrets privately, and run `npm start`.
Writes remain disabled unless explicitly configured. Keep local journal data outside
version control. Remote deployments require HTTPS. The seven original reads, bearer
authentication, Host/Origin checks, response limits and upstream secret redaction remain.
See TEST-REPORT.md for exact scope and limitations.
