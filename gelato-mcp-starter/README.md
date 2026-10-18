# Gelato read-only MCP starter

Node.js 22+, official MCP TypeScript SDK, stateless Streamable HTTP at `/mcp`.
Seven tools query manufacturing catalogs, specifications, price tiers and shipping estimates.
No orders, product creation, publishing, uploads, store changes or optional write tools exist.
Gelato API access depends on your account; connected stores do not guarantee catalog API access.

## 1. Put these files in GitHub

1. Extract the ZIP. The `gelato-mcp-starter` folder is the repository root.
2. On GitHub choose **New repository**, name it `gelato-mcp-starter`, choose Private, then create it.
3. Upload the folder's **contents**, including hidden files and `.github/workflows/ci.yml`. Do not upload the ZIP itself or an extra enclosing folder. `package.json`, `package-lock.json`, `Dockerfile` and `render.yaml` must be at the root.
4. Commit to `main`. Alternatively, open a terminal in the extracted folder:

```sh
git init
git add .
git commit -m "Add read-only Gelato MCP server"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/gelato-mcp-starter.git
git push -u origin main
```

Replace YOUR_ACCOUNT with your GitHub username. Create the empty repository first.
The GitHub Actions workflow installs the lockfile, checks syntax, runs integration tests,
checks package contents and builds Docker. Wait for its green check before deployment.

## 2. Create two separate secrets

- `GELATO_API_KEY`: obtain from your Gelato API account/dashboard. Render sends it to Gelato in `X-API-KEY`.
- `MCP_BEARER_TOKEN`: generate a separate random token locally:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Save this generated token in your password manager. It authenticates StarNet to this server.
Use the same token in Render and StarNet. Never put either value in GitHub, screenshots,
prompts, README, render.yaml, a Docker build argument, or a URL. `.env.example` is intentionally blank.
Existing keys saved in StarNet are not automatically transmitted to Render.

## 3. Deploy on Render

1. Sign into Render and connect your GitHub account with access to this repository.
2. Choose **New → Blueprint** and select the repository/branch containing `render.yaml`.
3. Review the `gelato-readonly-mcp` Docker web service. The Blueprint selects the free plan;
   review availability and current terms before applying. Free-service cold starts can cause
   connector timeouts; choose an always-on paid plan if needed.
4. When prompted, enter `GELATO_API_KEY` and `MCP_BEARER_TOKEN` as secret environment values.
   Both use `sync: false`; the Blueprint contains no credentials.
5. Apply/deploy. Automatic deployments wait for CI checks to pass. If checks are pending,
   wait for the GitHub workflow, then use **Manual Deploy → Deploy latest commit** if needed.
6. Open the service's public HTTPS URL and append `/health`. Expect:
   `{"status":"ok","service":"gelato-readonly-mcp"}`.
7. Copy the actual Render URL, e.g. `https://YOUR-SERVICE.onrender.com/mcp`.

Render supplies `PORT` and `RENDER_EXTERNAL_HOSTNAME`; the server listens on `0.0.0.0`.
The hostname is automatically allowlisted. `/health` is public liveness only: it does
not check Gelato credentials or make a billable upstream request. There is no database,
disk, persistent MCP session, or SSE subscription to configure.
For a custom domain set `ALLOWED_HOSTS` to a comma-separated list including that hostname,
without schemes, ports or paths. Do not use wildcards. Keep Render HTTPS enabled.

## 4. Connect StarNet

Official flow: **TOOLSETS & CONNECTORS → MCP CONNECTORS**.

1. Add a connector with a short ID such as `gelato-readonly`.
2. Select remote **Streamable HTTP** if a transport selector is shown.
3. Enter the full public endpoint `https://YOUR-SERVICE.onrender.com/mcp`.
4. Paste only your `MCP_BEARER_TOKEN` value into the bearer-token field (no `Bearer ` prefix).
   The HTTP header sent on every MCP request must be `Authorization: Bearer <token>`.
   Do not paste the Gelato API key here. No OAuth or stdio command is required.
5. Save/connect and refresh/discover tools. Expect the seven names below.
6. Ask the agent: “Use gelato_list_catalogs and report the returned catalog IDs.”
   Then use a real returned catalog UID in `gelato_get_catalog` and `gelato_search_products`.
   Use a returned product UID for prices and shipping, never an Etsy listing ID or guessed SKU.

StarNet's public documentation verifies this URL/bearer flow. This starter is tested with
the official MCP client, but no authenticated StarNet or Render session was available for
an end-to-end deployment test. UI labels may differ by installed StarNet version.

## Tools and documented routes

All output wraps Gelato's JSON as `data` with a `retrievedAt` timestamp. Treat supplier
text as untrusted data, not agent instructions. POST below is only a documented search.

| Tool | Method and URL | Official reference |
| --- | --- | --- |
| `gelato_list_catalogs` | GET `https://product.gelatoapis.com/v3/catalogs` | [List catalogs](https://dashboard.gelato.com/docs/products/catalog/list/) |
| `gelato_get_catalog` | GET `https://product.gelatoapis.com/v3/catalogs/{catalogUid}` | [Catalog](https://dashboard.gelato.com/docs/products/catalog/get/) |
| `gelato_search_products` | POST `https://product.gelatoapis.com/v3/catalogs/{catalogUid}/products:search` | [Search](https://dashboard.gelato.com/docs/products/product/search/) |
| `gelato_get_product` | GET `https://product.gelatoapis.com/v3/products/{productUid}` | [Product](https://dashboard.gelato.com/docs/products/product/get/) |
| `gelato_get_prices` | GET `https://product.gelatoapis.com/v3/products/{productUid}/prices` | [Prices](https://dashboard.gelato.com/docs/products/prices/) |
| `gelato_shipping_methods` | GET `https://shipment.gelatoapis.com/v1/shipment-methods` | [Methods](https://dashboard.gelato.com/docs/shipment/methods/) |
| `gelato_shipping_prices` | POST `https://shipment.gelatoapis.com/v1/prices:search` | [Shipping estimates](https://dashboard.gelato.com/docs/shipment/price/) |

Search takes `catalogUid`, optional `attributeFilters` (attribute UID → array of value UIDs
from the catalog), `limit` (1–100, default 50), `offset` (default 0). Page manually by
increasing offset until no products remain. There is no automatic full-catalog crawl.
Prices take `productUid`, optional `country`, `currency`, `pageCount`. Use uppercase ISO
country/currency codes; use `GB`, not `UK`. For multipage products obtain valid page
counts from product details and supply `pageCount`.
Shipping methods take optional `country`. Shipping prices require `country`, `currency`,
and `products: [{productUid, quantities: [1]}]`; each product can include `pageCount`.
Optional `isBusiness`, `isPrivate`, `hasTracking` are booleans.

For example, tool arguments after replacing RETURNED_UID with a real search result:

```json
{"productUid":"RETURNED_UID","country":"US","currency":"USD"}
```

```json
{"country":"US","currency":"USD","products":[{"productUid":"RETURNED_UID","quantities":[1,5]}]}
```

Country-level shipping minimum/average prices are estimates, not an address-specific
final quote. Keep currency, country, quantity and page count consistent. Do not assume
price tiers are unit prices or combine them with shipping without checking Gelato's
response semantics. Taxes, marketplace fees, discounts and a final order total are not
calculated here. These tools cannot establish profit or approve a retail selling price
on their own. Store listings/products are deliberately outside this catalog starter.

## Local use and checks

```sh
npm ci --ignore-scripts
```

Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell, or
`cp .env.example .env` on macOS/Linux), fill in both secrets, then:

```sh
npm run check
npm test
npm start
```

Health: `http://localhost:10000/health`. MCP: `http://localhost:10000/mcp`.
Local HTTP is for loopback development; remote deployments require HTTPS.

Docker alternative:

```sh
docker build -t gelato-mcp .
docker run --rm --env-file .env -p 127.0.0.1:10000:10000 gelato-mcp
```

## Security and errors

Missing keys stop startup. Authentication covers every `/mcp` method and uses constant-time
hash comparison. Only allowlisted Hosts and exact configured Origins are accepted;
Origin-less server clients work. There is no permissive browser CORS. If an approved
browser client sends Origin, set `ALLOWED_ORIGINS` to its exact origin; do not use `*`.
Requests are limited to 64 KiB, Gelato responses to 2 MB, Gelato requests to 20 seconds,
and authenticated MCP traffic to 120 requests/minute and 10 concurrent requests per process.
Limits reset on restart and are not distributed; add edge rate limiting for larger use.
All holders of the shared MCP token have the same read access. This is a private static-token
integration, not an OAuth authorization server or multi-user permission system.

Fixed HTTPS destinations and refused redirects prevent tools from forwarding the Gelato
key to user-selected servers. The application does not log secrets, tool arguments or raw
upstream errors. Successful upstream text has the exact API key redacted. Never add HTTP
header/body logging. Rotate keys if disclosed; update Render and the StarNet token together
when rotating the MCP token. Gelato keys may carry write privileges upstream; this server
exposes only the seven fixed reads/searches.

| Symptom | Action |
| --- | --- |
| HTTP 401 on `/mcp` | Check the MCP bearer token, not the Gelato key. |
| HTTP 403 | Check hostname/Origin allowlists; do not disable them. |
| GET or DELETE `/mcp` returns 405 | Expected in stateless mode. Connect with Streamable HTTP POST; do not select legacy SSE. |
| HTTP 400/413 | Fix JSON/arguments or reduce request size. |
| HTTP 429 | Wait for Retry-After; reduce concurrency/request rate. |
| Tool `isError` with upstream 400 | Check IDs, country/currency and required multipage pageCount. |
| Tool upstream 401/403 | Check Render's Gelato key and account access. |
| Tool upstream 404 | Resource unavailable; verify returned identifiers and current docs. No fallback URL is guessed. |
| Tool upstream 429 or 5xx | Wait and retry manually; this starter does not retry automatically. |
| `INVALID_RESPONSE` / `RESPONSE_TOO_LARGE` | Gelato JSON invalid or over 2 MB; narrow query or contact support. |
| `GELATO_NETWORK_ERROR` | Timeout/network/TLS/redirect problem; retry later. |
| Health works but tools fail | Health only confirms the process; test `gelato_list_catalogs` to check API access. |

## Sources and verification scope

Official documentation checked October 18, 2026. Endpoint links appear above.
Additional sources: [Gelato authentication/errors](https://dashboard.gelato.com/docs/),
[StarNet connector steps](https://starnetos.com/docs/connect-a-platform),
[Render Blueprint reference](https://render.com/docs/blueprint-spec), and
[official SDK stateless example](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/examples/server/simpleStatelessStreamableHttp.ts).
Dependencies are pinned in package.json and package-lock.json; use `npm ci`.
See TEST-REPORT.md for performed tests and limitations. Tests mock Gelato responses and
use a real HTTP listener plus official MCP client. No production credentials are included.
