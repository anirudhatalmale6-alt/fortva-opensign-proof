'use strict';

/**
 * Boots the real receiver on an ephemeral port and drives five signed webhook
 * deliveries plus a tampered one through it, asserting on both the HTTP reply
 * and the line written to events.log.
 */

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET = 'whsec_live_test';
const LOG = path.join(__dirname, '..', 'events.log');
if (fs.existsSync(LOG)) fs.unlinkSync(LOG);

const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'webhook-server.js')], {
  env: { ...process.env, PORT: '0', OPENSIGN_WEBHOOK_SECRET: SECRET },
  stdio: ['ignore', 'pipe', 'inherit'],
});

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ' ' + extra}`);
  if (!cond) failures++;
};

const post = (url, payload, secret) => {
  const body = Buffer.from(JSON.stringify(payload));
  const headers = { 'Content-Type': 'application/json' };
  if (secret) headers['x-webhook-signature'] = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return fetch(url, { method: 'POST', headers, body });
};

child.stdout.on('data', async (chunk) => {
  const line = chunk.toString();
  const m = line.match(/http:\/\/127\.0\.0\.1:(\d+)\/webhooks\/opensign/);
  if (!m) return;
  const url = m[0];

  // Confirm the server we are about to talk to is the one we just spawned.
  const health = await (await fetch(`http://127.0.0.1:${m[1]}/healthz`)).json();
  check('spawned server answers /healthz', health.ok === true);

  const events = [
    { event: 'created', objectId: 'doc_1', name: 'Fortva proof', createdAt: '2026-08-14T09:00:00Z' },
    { event: 'viewed', objectId: 'doc_1', viewedBy: 'signer@example.com', viewedAt: '2026-08-14T09:05:00Z' },
    { event: 'signed', objectId: 'doc_1', signer: { email: 'signer@example.com' }, signedAt: '2026-08-14T09:06:00Z' },
    { event: 'completed', objectId: 'doc_1', file: 'https://sandbox/s.pdf', certificateUrl: 'https://sandbox/c.pdf', completedAt: '2026-08-14T09:07:00Z' },
    { event: 'declined', objectId: 'doc_2', declinedBy: 'other@example.com', declinedReason: 'terms changed' },
  ];

  for (const e of events) {
    const res = await post(url, e, SECRET);
    check(`${e.event} accepted (200)`, res.status === 200, `got ${res.status}`);
  }

  const bad = await post(url, { event: 'completed', objectId: 'doc_3' }, 'wrong-secret');
  check('forged signature rejected (401)', bad.status === 401, `got ${bad.status}`);

  const unsigned = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"event":"completed"}' });
  check('unsigned delivery rejected (401)', unsigned.status === 401, `got ${unsigned.status}`);

  await new Promise((r) => setTimeout(r, 200));
  const lines = fs.readFileSync(LOG, 'utf8').trim().split('\n').map(JSON.parse);
  check('7 deliveries logged', lines.length === 7, `got ${lines.length}`);
  check('5 verified, 2 not', lines.filter((l) => l.verified).length === 5);

  const completed = lines.find((l) => l.update.event === 'completed' && l.verified);
  check('completed row stores the signed pdf url', completed.update.signedPdfUrl === 'https://sandbox/s.pdf');
  check('completed row stores the certificate url', completed.update.certificateUrl === 'https://sandbox/c.pdf');
  check('completed row maps to status completed', completed.update.status === 'completed');

  const declined = lines.find((l) => l.update.event === 'declined');
  check('declined row keeps the reason', declined.update.reason === 'terms changed');

  console.log(failures ? `\n${failures} failures` : '\nall webhook deliveries handled correctly');
  child.kill('SIGTERM');
  process.exit(failures ? 1 : 0);
});
