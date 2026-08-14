'use strict';

/**
 * Thin OpenSign REST client.
 *
 * This is deliberately the only place that knows about OpenSign's wire format.
 * In Fortva it should sit behind whatever provider interface DocuSign/Documenso
 * currently implement, so swapping providers stays a one-file change.
 *
 * Docs: https://docs.opensignlabs.com/docs/API-docs/v1.2/intro/
 * Auth: every request carries `x-api-token`.
 */

const BASE_URLS = {
  sandbox: 'https://sandbox.opensignlabs.com/api/v1.2',
  production: 'https://app.opensignlabs.com/api/v1.2',
  eu: 'https://eu-app.opensignlabs.com/api/v1.2',
};

class OpenSignError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'OpenSignError';
    this.status = status;
    this.body = body;
  }
}

class OpenSignClient {
  /**
   * @param {object} opts
   * @param {string} opts.apiToken  x-api-token from Settings > API Token
   * @param {'sandbox'|'production'|'eu'|string} [opts.env]  named env or a full base URL
   * @param {number} [opts.timeoutMs]
   */
  constructor({ apiToken, env = 'sandbox', timeoutMs = 30000 } = {}) {
    if (!apiToken) throw new Error('apiToken is required');
    this.apiToken = apiToken;
    this.baseUrl = BASE_URLS[env] || env;
    this.timeoutMs = timeoutMs;
  }

  async request(method, path, body) {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'x-api-token': this.apiToken,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    if (!res.ok) {
      // 405 is OpenSign's "Invalid API Token!" — worth calling out explicitly,
      // it is not a "method not allowed" in the usual HTTP sense.
      const hint = res.status === 405 ? ' (OpenSign returns 405 for a bad/absent x-api-token)' : '';
      throw new OpenSignError(
        `${method} ${path} failed: ${res.status}${hint} ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`,
        res.status,
        parsed
      );
    }
    return parsed;
  }

  /**
   * Create a signature request from a raw PDF.
   * @param {object} doc
   * @param {string} doc.title
   * @param {string} [doc.note]
   * @param {string} doc.fileBase64   base64 of the PDF (no data: prefix)
   * @param {Array}  doc.signers      [{ name, email, role?, signer_role? }]
   * @param {Array}  doc.widgets      placement boxes, see buildSignatureWidget()
   * @param {boolean}[doc.sendInOrder]
   */
  createDocument({ title, note, fileBase64, signers, widgets, sendInOrder = false, ...rest }) {
    return this.request('POST', '/createdocument', {
      title,
      note,
      file: fileBase64,
      signers,
      widgets,
      send_in_order: sendInOrder,
      ...rest,
    });
  }

  /** Create from a saved template instead of uploading a file each time. */
  createDocumentFromTemplate(templateId, { signers, folderId, sendInOrder = false, ...rest } = {}) {
    return this.request('POST', `/createdocument/${templateId}`, {
      signers,
      folderId,
      send_in_order: sendInOrder,
      ...rest,
    });
  }

  /** Current status + signer state + signed/certificate URLs once complete. */
  getDocument(documentId) {
    return this.request('GET', `/document/${documentId}`);
  }

  /** Nudge signers who have not acted yet. */
  resend(documentId) {
    return this.request('POST', `/resenddocument/${documentId}`);
  }
}

/**
 * Convenience builder for a signature box.
 * Coordinates are top-left origin, in PDF points, per signer index.
 */
function buildSignatureWidget({ signerIndex, page = 1, x = 60, y = 560, w = 180, h = 55, type = 'signature' }) {
  return {
    signerIndex,
    type,
    page,
    x,
    y,
    w,
    h,
    options: { required: true, name: type },
  };
}

/**
 * Normalise the many shapes OpenSign can hand back into one status the app
 * can store. Keeps provider vocabulary out of Fortva's own contract records.
 */
function normaliseStatus(doc) {
  if (!doc) return 'unknown';
  const raw = (doc.status || doc.state || '').toString().toLowerCase();
  if (doc.isDeclined || raw.includes('decline')) return 'declined';
  if (doc.isCompleted || raw.includes('complete') || raw.includes('signed')) return 'completed';
  if (doc.isExpired || raw.includes('expire')) return 'expired';
  if (raw.includes('view')) return 'viewed';
  if (raw.includes('sent') || raw.includes('progress') || raw.includes('waiting')) return 'sent';
  if (raw.includes('draft')) return 'draft';
  return raw || 'sent';
}

/** Where the finished artefacts live, whichever field name the API used. */
function extractArtifacts(doc = {}) {
  return {
    signedPdfUrl: doc.signedUrl || doc.SignedUrl || doc.file || doc.url || null,
    certificateUrl: doc.certificateUrl || doc.CertificateUrl || doc.certificate || null,
  };
}

module.exports = {
  OpenSignClient,
  OpenSignError,
  BASE_URLS,
  buildSignatureWidget,
  normaliseStatus,
  extractArtifacts,
};
