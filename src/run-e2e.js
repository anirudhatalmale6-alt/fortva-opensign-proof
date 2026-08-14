'use strict';

/**
 * End-to-end proof: create a signature request, then poll until it is signed.
 *
 *   OPENSIGN_API_TOKEN=... SIGNER_EMAIL=you@example.com node src/run-e2e.js
 *
 * The signer gets an email from OpenSign; sign it in the browser and this
 * script prints the completed status plus the signed PDF and certificate URLs.
 */

const {
  OpenSignClient, OpenSignError, buildSignatureWidget, normaliseStatus, extractArtifacts,
} = require('./opensign');
const { buildSamplePdf } = require('./sample-pdf');

const TOKEN = process.env.OPENSIGN_API_TOKEN;
const ENV = process.env.OPENSIGN_ENV || 'sandbox';
const SIGNER_EMAIL = process.env.SIGNER_EMAIL;
const SIGNER_NAME = process.env.SIGNER_NAME || 'Test Signer';
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 600);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!TOKEN) throw new Error('Set OPENSIGN_API_TOKEN (Settings > API Token in OpenSign)');
  if (!SIGNER_EMAIL) throw new Error('Set SIGNER_EMAIL to a mailbox you can open');

  const client = new OpenSignClient({ apiToken: TOKEN, env: ENV });
  const pdf = buildSamplePdf();

  console.log(`env=${ENV} base=${client.baseUrl}`);
  console.log(`step 1/3  creating document (${pdf.length} byte PDF) for ${SIGNER_EMAIL}`);

  const created = await client.createDocument({
    title: 'Fortva integration proof',
    note: 'Automated end-to-end check of the OpenSign hand-off.',
    fileBase64: pdf.toString('base64'),
    signers: [{ name: SIGNER_NAME, email: SIGNER_EMAIL, role: 'Signer' }],
    widgets: [buildSignatureWidget({ signerIndex: 0, page: 1, x: 60, y: 620 })],
  });

  const documentId = created?.objectId || created?.documentId || created?.id;
  console.log(`step 2/3  created objectId=${documentId}`);
  console.log('          sign it from the email OpenSign just sent, or open the signing URL above');
  if (!documentId) {
    console.log('          raw response:', JSON.stringify(created));
    throw new Error('no document id in the create response - check the response shape');
  }

  const deadline = Date.now() + POLL_SECONDS * 1000;
  let last = null;
  while (Date.now() < deadline) {
    const doc = await client.getDocument(documentId);
    const status = normaliseStatus(doc);
    if (status !== last) {
      console.log(`          status -> ${status}`);
      last = status;
    }
    if (status === 'completed' || status === 'declined' || status === 'expired') {
      const artifacts = extractArtifacts(doc);
      console.log(`step 3/3  finished as ${status}`);
      console.log(`          signed pdf : ${artifacts.signedPdfUrl || '(none)'}`);
      console.log(`          certificate: ${artifacts.certificateUrl || '(none)'}`);
      return status === 'completed' ? 0 : 1;
    }
    await sleep(10000);
  }
  console.log(`step 3/3  timed out after ${POLL_SECONDS}s, last status=${last}`);
  return 2;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof OpenSignError) console.error(`OpenSign API error ${err.status}: ${err.message}`);
    else console.error(err.message);
    process.exit(1);
  });
