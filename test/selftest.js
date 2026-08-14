'use strict';

/**
 * Everything that can be proven without a paid OpenSign token:
 *  - the sandbox endpoint and auth header are the right ones
 *  - webhook HMAC verification accepts a good signature and rejects tampering
 *  - each webhook event maps to the contract status Fortva should store
 *  - the generated PDF is structurally valid
 */

const assert = require('assert');
const crypto = require('crypto');
const { verifySignature, toContractUpdate, EVENTS } = require('../src/webhook');
const { normaliseStatus, extractArtifacts, BASE_URLS, OpenSignClient } = require('../src/opensign');
const { buildSamplePdf } = require('../src/sample-pdf');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

const SECRET = 'whsec_test_key';
const body = Buffer.from(JSON.stringify({ event: 'completed', objectId: 'abc123' }));
const goodHex = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
const goodB64 = crypto.createHmac('sha256', SECRET).update(body).digest('base64');

console.log('webhook signature');
check('accepts a valid hex signature', () => assert.strictEqual(verifySignature(body, goodHex, SECRET).valid, true));
check('accepts a valid base64 signature', () => assert.strictEqual(verifySignature(body, goodB64, SECRET).valid, true));
check('accepts a sha256= prefix', () => assert.strictEqual(verifySignature(body, `sha256=${goodHex}`, SECRET).valid, true));
check('rejects a tampered body', () => assert.strictEqual(verifySignature(Buffer.concat([body, Buffer.from(' ')]), goodHex, SECRET).valid, false));
check('rejects a wrong secret', () => assert.strictEqual(verifySignature(body, goodHex, 'other').valid, false));
check('rejects a missing header', () => assert.strictEqual(verifySignature(body, undefined, SECRET).valid, false));
check('rejects a short signature without throwing', () => assert.strictEqual(verifySignature(body, 'deadbeef', SECRET).valid, false));

console.log('event mapping');
check('created -> sent', () => assert.strictEqual(toContractUpdate({ event: 'created', objectId: 'd1' }).status, 'sent'));
check('viewed keeps the actor', () => {
  const u = toContractUpdate({ event: 'viewed', objectId: 'd1', viewedBy: 'a@b.com' });
  assert.strictEqual(u.status, 'viewed');
  assert.strictEqual(u.actor, 'a@b.com');
});
check('signed -> partially_signed', () => assert.strictEqual(toContractUpdate({ event: 'signed', signer: { email: 'a@b.com' } }).status, 'partially_signed'));
check('completed carries pdf + certificate', () => {
  const u = toContractUpdate({ event: 'completed', objectId: 'd1', file: 'https://x/s.pdf', certificateUrl: 'https://x/c.pdf' });
  assert.strictEqual(u.status, 'completed');
  assert.strictEqual(u.signedPdfUrl, 'https://x/s.pdf');
  assert.strictEqual(u.certificateUrl, 'https://x/c.pdf');
});
check('declined carries the reason', () => {
  const u = toContractUpdate({ event: 'declined', declinedBy: 'a@b.com', declinedReason: 'wrong terms' });
  assert.strictEqual(u.status, 'declined');
  assert.strictEqual(u.reason, 'wrong terms');
});
check('every documented event maps to a known status', () => {
  for (const e of EVENTS) assert.notStrictEqual(toContractUpdate({ event: e }).status, 'unknown', e);
});

console.log('status normalisation');
check('isCompleted wins', () => assert.strictEqual(normaliseStatus({ isCompleted: true }), 'completed'));
check('declined wins over completed', () => assert.strictEqual(normaliseStatus({ isDeclined: true, status: 'completed' }), 'declined'));
check('in progress -> sent', () => assert.strictEqual(normaliseStatus({ status: 'In Progress' }), 'sent'));
check('artifacts fall back across field names', () => assert.strictEqual(extractArtifacts({ signedUrl: 'https://x/s.pdf' }).signedPdfUrl, 'https://x/s.pdf'));

console.log('sample pdf');
const pdf = buildSamplePdf();
check('starts with a PDF header', () => assert.ok(pdf.subarray(0, 8).toString().startsWith('%PDF-1.')));
check('ends with EOF', () => assert.ok(pdf.toString('latin1').trimEnd().endsWith('%%EOF')));
check('has an xref table', () => assert.ok(pdf.toString('latin1').includes('\nxref\n')));
check('base64 round-trips', () => assert.ok(Buffer.from(pdf.toString('base64'), 'base64').equals(pdf)));

console.log('client wiring');
check('sandbox base url', () => assert.strictEqual(new OpenSignClient({ apiToken: 't' }).baseUrl, BASE_URLS.sandbox));
check('a custom base url passes through', () => assert.strictEqual(new OpenSignClient({ apiToken: 't', env: 'https://self.host/api/v1.2' }).baseUrl, 'https://self.host/api/v1.2'));
check('missing token throws early', () => assert.throws(() => new OpenSignClient({})));

(async () => {
  console.log('live endpoint probe (no valid token needed)');
  await checkAsync('sandbox rejects a bad token with the documented 405', async () => {
    const client = new OpenSignClient({ apiToken: 'selftest-invalid-token', timeoutMs: 20000 });
    await assert.rejects(
      () => client.createDocument({ title: 't', fileBase64: '', signers: [], widgets: [] }),
      (err) => {
        assert.strictEqual(err.status, 405, `expected 405, got ${err.status}`);
        assert.match(JSON.stringify(err.body), /Invalid API Token/i);
        return true;
      }
    );
  });

  console.log(`\n${passed} checks passed${process.exitCode ? ', with failures above' : ''}`);
})();
