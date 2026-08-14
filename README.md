# OpenSign integration proof — Fortva

A standalone harness for the OpenSign e-signature hand-off, built before touching
the Fortva codebase so the provider swap can be verified in isolation.

Everything here is provider-facing only. In Fortva, `src/opensign.js` and
`src/webhook.js` are the two files that should sit behind the existing
DocuSign/Documenso provider interface — nothing else needs to know which
e-sign vendor is in use.

## What has been verified

Run `npm run selftest` — 25 checks, no API token required:

- the sandbox base URL (`https://sandbox.opensignlabs.com/api/v1.2`) and the
  `x-api-token` auth header are correct, confirmed with a live probe: OpenSign
  answers `405 {"error":"Invalid API Token!"}` for a bad token, exactly as documented
- webhook HMAC-SHA256 verification accepts good hex/base64/`sha256=`-prefixed
  signatures and rejects tampered bodies, wrong secrets and missing headers
- all five documented events (`created`, `viewed`, `signed`, `completed`, `declined`)
  map to a contract status, with the signed-PDF URL, certificate URL, actor and
  decline reason pulled out
- the generated sample PDF is structurally valid and survives base64 round-trip

Run `node test/webhook-live.js` — 14 checks against the real receiver on an
ephemeral port: five signed deliveries accepted, a forged and an unsigned
delivery rejected with 401, and every row written correctly to `events.log`.

## What still needs a token

`npm run e2e` performs the actual create → send → sign → completed run:

```
OPENSIGN_API_TOKEN=... SIGNER_EMAIL=you@example.com npm run e2e
```

It creates a document from a generated PDF, places a signature widget, sends it
to the signer, then polls `GET /document/:id` until the document reports
completed, declined or expired, printing the signed PDF and certificate URLs.

To also watch the push side:

```
OPENSIGN_WEBHOOK_SECRET=... PORT=4310 npm run webhook
```

then point Settings → Webhook at that URL (through a tunnel in development).

## Notes that matter for the Fortva integration

- **405 means bad token**, not "method not allowed". Worth a specific error branch
  so an expired token does not get logged as a routing bug.
- **Verify the HMAC over the raw body.** If the route JSON-parses and
  re-serialises before verifying, every signature fails. `webhook-server.js`
  uses `express.raw()` for exactly this reason.
- **Live webhooks and live API tokens need a paid OpenSign plan** (Professional
  or Teams). Sandbox tokens and sandbox webhooks work on the free tier, which is
  enough to prove the whole flow end to end.
- **Templates beat file uploads** for a contract platform: `POST /createdocument/:template_id`
  avoids shipping a base64 PDF on every send, and keeps field placement stable.

## Layout

```
src/opensign.js         REST client + status normalisation
src/webhook.js          HMAC verification + event → contract-status mapping
src/webhook-server.js   runnable receiver, logs to events.log
src/sample-pdf.js       dependency-free one-page PDF for the proof run
src/run-e2e.js          the create → send → poll-until-signed run
test/selftest.js        25 checks, no token needed
test/webhook-live.js    14 checks against the live receiver
```
