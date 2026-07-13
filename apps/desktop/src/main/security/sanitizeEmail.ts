import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { type EmailDetailSanitized } from '@apollo/shared';

/**
 * C13 email sanitizer. DOMPurify allowlist (p,br,div,span,a,ul,ol,li,blockquote,
 * strong,em,img→placeholder); no script/style/iframe/form/event handlers; remote
 * images stripped and counted; links open only in the external browser.
 */
const ALLOWED_TAGS = ['p', 'br', 'div', 'span', 'a', 'ul', 'ol', 'li', 'blockquote', 'strong', 'em', 'img'];
const ALLOWED_ATTR = ['href', 'src', 'alt'];

export interface SanitizeResult {
  safeHtml: string;
  plainText: string;
  remoteImagesBlocked: number;
}

function isRemote(src: string): boolean {
  return /^https?:\/\//i.test(src) || /^\/\//.test(src);
}

export function sanitizeEmailHtml(dirtyHtml: string, opts: { loadImages?: boolean } = {}): SanitizeResult {
  const window = new JSDOM('').window;
  const DOMPurify = createDOMPurify(window as unknown as Window & typeof globalThis);
  let remoteImagesBlocked = 0;

  DOMPurify.addHook('uponSanitizeElement', (node) => {
    // Defense in depth: drop dangerous elements even if config were bypassed.
    const el = node as Element;
    if (el.tagName && ['SCRIPT', 'STYLE', 'IFRAME', 'FORM', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE'].includes(el.tagName)) {
      el.remove();
    }
  });

  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    const name = data.attrName;
    // strip every event handler and javascript:/data: (except image data handled below)
    if (name.startsWith('on')) {
      data.keepAttr = false;
      return;
    }
    if (name === 'href') {
      const v = data.attrValue.trim().toLowerCase();
      if (v.startsWith('javascript:') || v.startsWith('data:') || v.startsWith('vbscript:')) {
        data.keepAttr = false;
      }
    }
    if (name === 'src' && (node as Element).tagName === 'IMG') {
      if (isRemote(data.attrValue)) {
        remoteImagesBlocked += 1;
        if (!opts.loadImages) {
          // replace with a neutral placeholder (kept, but not remote-loading)
          data.attrValue = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
        }
      }
    }
  });

  const safeHtml = DOMPurify.sanitize(dirtyHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'object', 'embed', 'link', 'meta', 'base'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick'],
    ALLOW_DATA_ATTR: false,
  });

  DOMPurify.removeAllHooks();

  // Plain-text extraction from the sanitized DOM; block elements become spaces
  // so adjacent paragraphs/list items do not run their words together.
  const doc = new JSDOM(`<body>${safeHtml}</body>`).window.document;
  for (const el of doc.querySelectorAll('p, div, br, li, blockquote, ul, ol')) {
    el.append(doc.createTextNode(' '));
  }
  const plainText = (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();

  return { safeHtml, plainText, remoteImagesBlocked };
}

/** Builds the sanitized detail DTO for the emailDetail card. */
export function toSanitizedDetail(
  raw: { id: string; from: string; to: string[]; subject: string; ts: number; html: string },
  opts: { loadImages?: boolean } = {},
): EmailDetailSanitized {
  const s = sanitizeEmailHtml(raw.html, opts);
  return {
    id: raw.id,
    from: raw.from,
    to: raw.to,
    subject: raw.subject,
    ts: raw.ts,
    safeHtml: s.safeHtml,
    plainText: s.plainText,
    remoteImagesBlocked: s.remoteImagesBlocked,
  };
}
