'use strict';

const crypto = require('crypto');

/**
 * OpenSign signs each webhook body with HMAC-SHA256 using the webhook security
 * key from Settings > Webhook, and sends the digest in `x-webhook-signature`.
 *
 * The signature is computed over the RAW request body, so the receiving route
 * must not have already JSON-parsed and re-serialised it. That is the single
 * most common reason a working integration starts rejecting every event.
 */
function verifySignature(rawBody, signatureHeader, secret) {
  if (!secret) return { valid: false, reason: 'no secret configured' };
  if (!signatureHeader) return { valid: false, reason: 'missing x-webhook-signature header' };

  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  const expectedHex = crypto.createHmac('sha256', secret).update(buf).digest('hex');
  const expectedB64 = crypto.createHmac('sha256', secret).update(buf).digest('base64');

  // Accept either encoding, and strip a `sha256=` prefix if one is present.
  const received = String(signatureHeader).replace(/^sha256=/i, '').trim();

  for (const candidate of [expectedHex, expectedB64]) {
    if (received.length === candidate.length &&
        crypto.timingSafeEqual(Buffer.from(received), Buffer.from(candidate))) {
      return { valid: true };
    }
  }
  return { valid: false, reason: 'signature mismatch', expectedHex };
}

const EVENTS = ['created', 'viewed', 'signed', 'completed', 'declined'];

/**
 * Turn a webhook payload into the fields Fortva would write onto its own
 * contract record. Deliberately tolerant about field naming.
 */
function toContractUpdate(payload = {}) {
  const event = (payload.event || payload.type || '').toString().toLowerCase();
  const base = {
    event,
    documentId: payload.objectId || payload.documentId || payload.id || null,
    occurredAt: payload.completedAt || payload.signedAt || payload.viewedAt ||
                payload.declinedAt || payload.createdAt || null,
    raw: payload,
  };

  switch (event) {
    case 'created':
      return { ...base, status: 'sent' };
    case 'viewed':
      return { ...base, status: 'viewed', actor: payload.viewedBy || null };
    case 'signed':
      return { ...base, status: 'partially_signed', actor: payload.signer?.email || null };
    case 'completed':
      return {
        ...base,
        status: 'completed',
        signedPdfUrl: payload.file || payload.signedUrl || null,
        certificateUrl: payload.certificateUrl || payload.certificate || null,
      };
    case 'declined':
      return {
        ...base,
        status: 'declined',
        actor: payload.declinedBy || null,
        reason: payload.declinedReason || null,
      };
    default:
      return { ...base, status: 'unknown' };
  }
}

module.exports = { verifySignature, toContractUpdate, EVENTS };
