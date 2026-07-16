import { describe, expect, it } from 'vitest';
import { assertPublicHost, assertPublicUrl, isPrivateOrReservedIp, SsrfError } from './ssrfGuard';

describe('I4 SSRF guard: IP classification', () => {
  it('flags loopback, private, link-local, CGNAT, and reserved ranges', () => {
    for (const ip of ['127.0.0.1', '127.1.2.3', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1']) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(true);
    }
  });
  it('flags IPv6 loopback, link-local, unique-local, and v4-mapped private', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(true);
    }
  });
  it('allows public unicast addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '203.0.113.10', '2606:4700:4700::1111']) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(false);
    }
  });
});

describe('I4 SSRF guard: host + URL assertions', () => {
  const publicDns = async (): Promise<string[]> => ['93.184.216.34'];
  const privateDns = async (): Promise<string[]> => ['10.0.0.5'];
  const metadataDns = async (): Promise<string[]> => ['169.254.169.254'];

  it('rejects localhost by name before any DNS', async () => {
    await expect(assertPublicHost('localhost', publicDns)).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicHost('app.localhost', publicDns)).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects a host that resolves to a private address (DNS-rebind style)', async () => {
    await expect(assertPublicHost('rebind.evil.com', privateDns)).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicHost('metadata.evil.com', metadataDns)).rejects.toBeInstanceOf(SsrfError);
  });

  it('accepts a host that resolves to a public address', async () => {
    await expect(assertPublicHost('example.com', publicDns)).resolves.toEqual(['93.184.216.34']);
  });

  it('classifies bare IP-literal hosts directly', async () => {
    await expect(assertPublicHost('169.254.169.254', publicDns)).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicHost('8.8.8.8', publicDns)).resolves.toEqual(['8.8.8.8']);
  });

  it('assertPublicUrl rejects non-http(s) protocols and SSRF hosts', async () => {
    await expect(assertPublicUrl('ftp://example.com/x', publicDns)).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicUrl('file:///etc/passwd', publicDns)).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data/', publicDns)).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicUrl('http://localhost:8080/admin', publicDns)).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicUrl('https://example.com/post', publicDns)).resolves.toBeInstanceOf(URL);
  });
});
