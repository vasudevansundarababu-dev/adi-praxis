# Security policy

Report vulnerabilities **privately**, never in a public issue, pull request or chat message:

1. Open https://github.com/vasudevansundarababu-dev/adi-praxis/security/advisories/new
2. Give the affected URL or endpoint, the build (from the banner or `GET /api/v1/version`), exact steps, the impact,
   and screenshots or request/response pairs with any session cookies and API keys removed.
3. Rate it with CVSS 3.1 if you can (see `docs/testing/PENTEST.md`).

Only the test environment is in scope. Testing rules (what is allowed, rate limits, time windows) are in
`docs/testing/PENTEST.md`. We acknowledge reports within one working day (IST) and fix critical findings before any
other work. Security findings are never given to the automated nightly agent.
