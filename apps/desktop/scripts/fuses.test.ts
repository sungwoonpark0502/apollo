import { describe, expect, it } from 'vitest';
import { FuseV1Options } from '@electron/fuses';
import { REQUIRED_FUSES } from './fuses.mjs';

/**
 * H3: the fuse verification (build-time afterPack) is driven by REQUIRED_FUSES.
 * This asserts the required set matches the spec so a regression in the config
 * is caught in CI, not only at package time.
 */
describe('Electron fuse configuration (H3)', () => {
  it('locks down the required fuses exactly per spec', () => {
    expect(REQUIRED_FUSES[FuseV1Options.RunAsNode]).toBe(false);
    expect(REQUIRED_FUSES[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(false);
    expect(REQUIRED_FUSES[FuseV1Options.EnableNodeCliInspectArguments]).toBe(false);
    expect(REQUIRED_FUSES[FuseV1Options.EnableCookieEncryption]).toBe(true);
    expect(REQUIRED_FUSES[FuseV1Options.OnlyLoadAppFromAsar]).toBe(true);
  });
});
