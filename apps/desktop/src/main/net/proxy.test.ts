import { describe, expect, it } from 'vitest';
import { agentForResolvedProxy, proxyUrlFromResolved } from './proxy';

describe('WS proxy agent selection (H4)', () => {
  it('DIRECT yields no proxy (direct connection)', () => {
    expect(proxyUrlFromResolved('DIRECT')).toBeNull();
    expect(agentForResolvedProxy('DIRECT')).toBeNull();
  });

  it('picks the first PROXY entry', () => {
    expect(proxyUrlFromResolved('PROXY proxy.corp:8080; DIRECT')).toBe('http://proxy.corp:8080');
  });

  it('maps HTTPS and SOCKS schemes', () => {
    expect(proxyUrlFromResolved('HTTPS secure.proxy:443')).toBe('https://secure.proxy:443');
    expect(proxyUrlFromResolved('SOCKS5 socks.host:1080')).toBe('socks://socks.host:1080');
  });

  it('skips DIRECT prefixes and takes the next proxy', () => {
    expect(proxyUrlFromResolved('DIRECT; PROXY fallback:3128')).toBe('http://fallback:3128');
  });

  it('builds an agent only when a proxy is present', () => {
    expect(agentForResolvedProxy('PROXY p:8080')).not.toBeNull();
    expect(agentForResolvedProxy('')).toBeNull();
  });
});
