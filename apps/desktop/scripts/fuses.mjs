// H3 Electron Fuses. Applied in electron-builder's afterPack hook, then read back
// and verified; the build fails if any fuse is wrong.
import { flipFuses, FuseVersion, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

/** The fuse configuration required by H3. */
export const REQUIRED_FUSES = {
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
};

function electronBinaryPath(appOutDir, electronPlatformName, productName = 'Apollo') {
  if (electronPlatformName === 'darwin' || electronPlatformName === 'mas') {
    return join(appOutDir, `${productName}.app/Contents/MacOS/${productName}`);
  }
  if (electronPlatformName === 'win32') return join(appOutDir, `${productName}.exe`);
  return join(appOutDir, productName.toLowerCase());
}

/** electron-builder afterPack hook. */
export default async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const productName = packager?.appInfo?.productFilename ?? 'Apollo';
  const target = electronBinaryPath(appOutDir, electronPlatformName, productName);
  if (!existsSync(target)) {
    console.warn(`fuses: binary not found at ${target}; skipping`);
    return;
  }
  await flipFuses(target, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: electronPlatformName === 'darwin' || electronPlatformName === 'mas',
    ...REQUIRED_FUSES,
    // macOS ASAR integrity validation
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    ...(electronPlatformName === 'darwin' ? { [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true } : {}),
  });

  // Read the fuses back and fail the build on any mismatch (H3).
  const wire = await getCurrentFuseWire(target);
  const problems = [];
  for (const [fuse, want] of Object.entries(REQUIRED_FUSES)) {
    const got = wire[fuse];
    if (got !== want) problems.push(`fuse ${FuseV1Options[fuse] ?? fuse}: want ${want}, got ${got}`);
  }
  if (problems.length) {
    throw new Error(`fuse verification failed:\n${problems.join('\n')}`);
  }
  console.log('fuses: applied and verified');
}
