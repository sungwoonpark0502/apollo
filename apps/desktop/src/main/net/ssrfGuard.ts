import dns from 'node:dns';

/**
 * I4 SSRF guard for the user-link lane (link.read). Only http/https public
 * hosts are reachable: after DNS resolution every resolved address must be a
 * public unicast IP. Loopback, private, link-local, unique-local, and
 * unspecified ranges are rejected — for the initial URL and every redirect hop.
 */
export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

export type DnsResolver = (host: string) => Promise<string[]>;

const defaultResolver: DnsResolver = async (host) => {
  const records = await dns.promises.lookup(host, { all: true });
  return records.map((r) => r.address);
};

/** True when an IPv4/IPv6 literal is NOT a routable public address. */
export function isPrivateOrReservedIp(ip: string): boolean {
  const addr = ip.trim().toLowerCase();
  if (addr.includes(':')) return isPrivateIpv6(addr);
  return isPrivateIpv4(addr);
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // malformed → reject
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl. 169.254.169.254 cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const addr = ip.split('%')[0]!; // strip zone id
  if (addr === '::1' || addr === '::') return true; // loopback / unspecified
  if (addr.startsWith('fe80') || addr.startsWith('fe9') || addr.startsWith('fea') || addr.startsWith('feb')) return true; // link-local fe80::/10
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true; // unique-local fc00::/7
  // IPv4-mapped (::ffff:a.b.c.d) → classify the embedded v4 address
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped) return isPrivateIpv4(mapped[1]!);
  return false;
}

/**
 * Resolves `host` and throws SsrfError if it is missing or resolves to any
 * non-public address. Returns the resolved public addresses on success.
 */
export async function assertPublicHost(host: string, resolver: DnsResolver = defaultResolver): Promise<string[]> {
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) throw new SsrfError('localhost is not allowed');
  // A bare IP literal host is classified directly (no DNS rebind window).
  if (isIpLiteral(lower)) {
    if (isPrivateOrReservedIp(lower)) throw new SsrfError(`private/reserved address rejected: ${host}`);
    return [lower];
  }
  let addrs: string[];
  try {
    addrs = await resolver(host);
  } catch {
    throw new SsrfError(`could not resolve ${host}`);
  }
  if (addrs.length === 0) throw new SsrfError(`no addresses for ${host}`);
  for (const a of addrs) {
    if (isPrivateOrReservedIp(a)) throw new SsrfError(`${host} resolves to a private/reserved address (${a})`);
  }
  return addrs;
}

function isIpLiteral(host: string): boolean {
  const h = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  return /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':');
}

/** Validates protocol + SSRF for a URL string; returns the parsed URL. */
export async function assertPublicUrl(url: string, resolver?: DnsResolver): Promise<URL> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new SsrfError(`invalid url: ${url}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new SsrfError(`unsupported protocol: ${u.protocol}`);
  await assertPublicHost(u.hostname.replace(/^\[|\]$/g, ''), resolver);
  return u;
}
