import { startCapture } from '../../lib/capture';

// Hidden capture window (C12.1): starts immediately; main gates actual use
// via worker modes, and mute stops capture entirely.
void startCapture().catch((e: unknown) => {
  console.error('capture failed', e);
});

window.apollo.on('voice.state', ({ state }) => {
  // Muted: physically stop the tracks (C12: capture fully stopped while muted).
  if (state === 'muted') void import('../../lib/capture').then((m) => m.stopCapture());
  else if (state === 'idle') void import('../../lib/capture').then((m) => m.ensureCapture());
});
