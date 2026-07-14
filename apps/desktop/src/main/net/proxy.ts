import { HttpsProxyAgent } from 'https-proxy-agent';

/**
 * H4 WebSocket proxy support (Deepgram). Electron's session.resolveProxy returns
 * a PAC-style string like "PROXY host:port; DIRECT" or "DIRECT". This pure
 * function turns that into a proxy URL (or null for a direct connection).
 */
export function proxyUrlFromResolved(resolved: string): string | null {
  // take the first non-DIRECT entry
  for (const part of resolved.split(';')) {
    const trimmed = part.trim();
    if (!trimmed || trimmed === 'DIRECT') continue;
    const m = trimmed.match(/^(PROXY|HTTPS|SOCKS5?)\s+(\S+)$/i);
    if (!m) continue;
    const scheme = /HTTPS/i.test(m[1] as string) ? 'https' : /SOCKS/i.test(m[1] as string) ? 'socks' : 'http';
    return `${scheme}://${m[2]}`;
  }
  return null;
}

/** Builds an https-proxy-agent when a proxy is present, else null (direct). */
export function agentForResolvedProxy(resolved: string): HttpsProxyAgent<string> | null {
  const url = proxyUrlFromResolved(resolved);
  return url ? new HttpsProxyAgent(url) : null;
}
