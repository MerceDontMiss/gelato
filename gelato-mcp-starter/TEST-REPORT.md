# Verification report

Verified October 18, 2026 on Windows, Node.js 22.18.0 and npm 10.9.3.

- PASS: clean `npm ci --ignore-scripts` using the included lockfile (95 packages installed).
- PASS: `npm run check` on server.js, gelato.js and test/server.test.js.
- PASS: `npm test`, four test groups, zero failures.
- PASS: real HTTP MCP initialization, tool discovery and all seven tool calls using the official MCP client and StreamableHTTPClientTransport.
- PASS: method, URL, query string, JSON body, X-API-KEY and redirect policy assertions for every Gelato route, with mocked responses.
- PASS: missing/invalid/identical credentials rejected; unauthenticated methods rejected; Host/Origin rejection; malformed/oversized JSON; stateless GET 405; invalid UID/limit and nonexistent write tool rejected without upstream calls.
- PASS: upstream 400/401/403/404/429/500/503 handling, network failure, invalid JSON, oversized response and secret redaction.
- PASS: authenticated request rate limit returns 429 with Retry-After.
- PASS: `npm audit --omit=dev`, zero known vulnerabilities at verification time.
- PASS: `npm pack --dry-run --json --offline` package manifest check. The repository ZIP separately includes package-lock.json and .gitignore, which npm pack intentionally omits.

Pinned runtime dependencies: @modelcontextprotocol/sdk 1.32.1, express 5.3.0, zod 3.25.76.

No live Gelato request was made: no user credentials were supplied. Actual account
access, product availability and live pricing require testing after deployment.
No authenticated GitHub, Render or StarNet session was used. Docker is not installed
in this test environment, so an image build was not executed locally; the included
GitHub Actions workflow builds it on Linux. Render Blueprint was reviewed against
official documentation but not submitted to Render's validation API.

This report does not claim a deployed service or an end-to-end StarNet connection.
