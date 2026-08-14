'use strict';

/**
 * Minimal receiver that stands in for whatever route Fortva will expose.
 * Run it, point OpenSign's Settings > Webhook at it (via a tunnel in dev),
 * and every event lands in events.log with its verification verdict.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { verifySignature, toContractUpdate } = require('./webhook');

const PORT = Number(process.env.PORT || 4310);
const SECRET = process.env.OPENSIGN_WEBHOOK_SECRET || '';
const LOG = path.join(__dirname, '..', 'events.log');

const app = express();

// Raw body — required for HMAC verification. Parse only after verifying.
app.post('/webhooks/opensign', express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
  const check = verifySignature(req.body, req.get('x-webhook-signature'), SECRET);

  let payload = {};
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'body is not JSON' });
  }

  const update = toContractUpdate(payload);
  const line = JSON.stringify({ at: new Date().toISOString(), verified: check.valid, reason: check.reason, update });
  fs.appendFileSync(LOG, line + '\n');
  console.log(`[webhook] ${update.event} doc=${update.documentId} verified=${check.valid} -> status=${update.status}`);

  if (SECRET && !check.valid) return res.status(401).json({ error: 'bad signature' });

  // Always ack fast; do the real work off the request path in production.
  res.status(200).json({ received: true });
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`webhook receiver on http://127.0.0.1:${server.address().port}/webhooks/opensign`);
  console.log(SECRET ? 'signature verification: ON' : 'signature verification: OFF (set OPENSIGN_WEBHOOK_SECRET)');
});
