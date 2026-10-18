# Verification — October 18, 2026

Base repository: https://github.com/MerceDontMiss/gelato
Base commit: a900d20206addf1263fca81efcef9799f4cc5720
Local runtime: Node.js 22.18.0, Windows.

`npm ci --ignore-scripts` completed; npm reported zero known vulnerabilities.
`npm run check` passed. `npm test` passed 9 tests, zero failures.
An additional offline dependency-install attempt failed because npm's local cache lacked
one dependency; normal network installation was used. Offline installation is not supported.

Coverage:
- Official MCP client handshake/discovery over real loopback HTTP; 11 tools discovered.
- Every original read and each added ecommerce read routed to its expected fixed URL.
- Bearer auth, disallowed Host/Origin, wrong HTTP method, malformed/oversized JSON,
  startup credential validation and authenticated request rate limit.
- Upstream HTTP/network/JSON/size failures and exact API-key redaction.
- Creation exposed as a write tool, dryRun defaults true, live call blocked by default.
- Preflight mapping, missing/duplicate variants, invalid placeholders, invalid artwork
  hosts/protocol/embedded credentials, changed arguments, write configuration failures.
- Correct creation URL/body, false visibility, internal control fields excluded upstream.
- Concurrent attempts, completed replay after journal recreation, conflicting payload/key,
  uncertain POST outcome after restart, corrupt journal rejection; at most one POST per key.

All Gelato responses were mocked. No production secrets were requested or used.
No real Gelato request, product/listing/order write, publication, GitHub push or Render
deployment was performed. Real account access, artwork quality, Etsy-specific effects,
SKU mapping, fulfillment sync and retail profitability remain unverified.

Docker executable was unavailable in this environment, so the Docker image was not built
locally. Added GitHub CI performs the Linux tests and Docker build after upload. Linux
directory fsync, persistent Render disk permissions and live StarNet connection require
verification in that target environment. Do not enable writes before provisioning and
checking durable storage; path configuration alone does not prove persistence.
