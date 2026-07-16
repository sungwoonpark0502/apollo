import { assertPublicUrl, SsrfError, type DnsResolver } from './ssrfGuard';

/**
 * I4 user-link lane. This is the ONLY code path allowed to reach arbitrary
 * public hosts, and only for user-provided links (the tool enforces the
 * user-substring gate). It bypasses the C14.9 allowlist but replaces it with a
 * strict SSRF guard, redirect re-checks, and hard size/time caps. It does not
 * widen egress for anything else — nothing else imports this module's fetch.
 */
export interface LinkReadResult {
  ok: boolean;
  url: string; // final URL after redirects
  title: string;
  siteName: string;
  text: string; // reduced readable text, or a short description for non-HTML
  contentType: string;
  error?: string;
}

export interface LinkReaderDeps {
  fetchFn: typeof fetch; // Electron net.fetch
  resolver?: DnsResolver; // injectable DNS for the SSRF guard (tests)
  log?: (msg: string) => void;
}

export const LINK_TOTAL_TIMEOUT_MS = 5000;
export const LINK_MAX_REDIRECTS = 3;
export const LINK_MAX_BYTES = 2 * 1024 * 1024; // 2MB
export const LINK_MAX_CHARS = 6000;

export function createLinkReader(deps: LinkReaderDeps) {
  async function fetchFollowing(startUrl: string, signal: AbortSignal): Promise<{ res: Response; finalUrl: string }> {
    let current = await assertPublicUrl(startUrl, deps.resolver); // guard the initial URL
    for (let hop = 0; hop <= LINK_MAX_REDIRECTS; hop++) {
      const res = await deps.fetchFn(current.toString(), { redirect: 'manual', signal, headers: { accept: 'text/html,*/*' } });
      if (res.status >= 300 && res.status < 400) {
        if (hop === LINK_MAX_REDIRECTS) throw new SsrfError('too many redirects');
        const loc = res.headers.get('location');
        if (!loc) return { res, finalUrl: current.toString() };
        const next = new URL(loc, current); // resolve relative redirects
        current = await assertPublicUrl(next.toString(), deps.resolver); // re-check every hop
        continue;
      }
      return { res, finalUrl: current.toString() };
    }
    throw new SsrfError('too many redirects');
  }

  async function read(url: string, opts: { previewOnly?: boolean } = {}): Promise<LinkReadResult> {
    const fail = (error: string): LinkReadResult => ({ ok: false, url, title: '', siteName: hostnameOf(url), text: '', contentType: '', error });
    let res: Response;
    let finalUrl: string;
    try {
      ({ res, finalUrl } = await fetchFollowing(url, AbortSignal.timeout(LINK_TOTAL_TIMEOUT_MS)));
    } catch (e) {
      const msg = e instanceof SsrfError ? e.message : e instanceof Error ? e.message : String(e);
      deps.log?.(`link.read blocked/failed: ${url} — ${msg}`);
      return fail(msg);
    }
    if (!res.ok) return { ...fail(`http ${res.status}`), url: finalUrl };

    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    const declaredLen = Number(res.headers.get('content-length') ?? '0');
    if (declaredLen > LINK_MAX_BYTES) return { ...fail('response too large'), url: finalUrl, contentType };

    // Non-HTML: describe, never return raw bytes to the model.
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return {
        ok: true, url: finalUrl, title: hostnameOf(finalUrl), siteName: hostnameOf(finalUrl),
        text: describeNonHtml(contentType), contentType,
      };
    }

    const buf = await readCapped(res, LINK_MAX_BYTES);
    const html = new TextDecoder('utf-8').decode(buf);
    const reduced = reduceHtml(html, finalUrl);
    const text = opts.previewOnly ? firstParagraph(reduced.text) : reduced.text.slice(0, LINK_MAX_CHARS);
    return { ok: true, url: finalUrl, title: reduced.title, siteName: reduced.siteName, text, contentType: contentType || 'text/html' };
  }

  return { read };
}

/** Read a response body, aborting once the byte cap is exceeded. */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) {
    const ab = await res.arrayBuffer();
    return new Uint8Array(ab.byteLength > maxBytes ? ab.slice(0, maxBytes) : ab);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
      if (total >= maxBytes) {
        void reader.cancel();
        break;
      }
    }
  }
  const out = new Uint8Array(Math.min(total, maxBytes));
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, out.byteLength - off);
    out.set(c.subarray(0, take), off);
    off += take;
    if (off >= out.byteLength) break;
  }
  return out;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function describeNonHtml(contentType: string): string {
  const type = contentType.split(';')[0]!.trim();
  const label =
    type.includes('pdf') ? 'a PDF document' :
    type.startsWith('image/') ? 'an image' :
    type.startsWith('video/') ? 'a video' :
    type.startsWith('audio/') ? 'an audio file' :
    type.includes('json') ? 'a JSON document' :
    `a ${type} file`;
  return `The link points to ${label}, not a readable web page. I can't summarize its contents.`;
}

/** A small readability pass: drop non-content elements, take main/article/body, strip tags. */
export function reduceHtml(html: string, url: string): { title: string; siteName: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(stripTags(titleMatch[1]!)).trim().slice(0, 200) : hostnameOf(url);
  const ogSite = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i.exec(html);
  const siteName = ogSite ? decodeEntities(ogSite[1]!).trim() : hostnameOf(url);

  // Prefer <body> so <head> metadata (title/meta) never leaks into the text.
  const bodyMatch = /<body[\s\S]*?<\/body>/i.exec(html);
  let body = (bodyMatch ? bodyMatch[0] : html.replace(/<head[\s\S]*?<\/head>/i, ' '))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const main = /<article[\s\S]*?<\/article>/i.exec(body) ?? /<main[\s\S]*?<\/main>/i.exec(body);
  if (main) body = main[0];

  const text = decodeEntities(stripTags(body)).replace(/\s+/g, ' ').trim();
  return { title, siteName, text };
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** First 1-2 sentences (or ~280 chars) for the preview summary. */
export function firstParagraph(text: string): string {
  const trimmed = text.trim();
  const twoSentences = /^(.*?[.!?])(\s+.*?[.!?])?/s.exec(trimmed);
  const candidate = twoSentences ? (twoSentences[1]! + (twoSentences[2] ?? '')).trim() : trimmed;
  return candidate.length > 300 ? `${candidate.slice(0, 297)}…` : candidate;
}
