/** STT adapter boundary (C12.4): Deepgram live and FakeSTT both implement this. */
export interface SttCallbacks {
  onPartial: (transcript: string, isFinal: boolean) => void;
  /** Provider endpoint event (Deepgram speech_final / UtteranceEnd). */
  onEndpoint: () => void;
  onError: (message: string) => void;
}

export interface SttSession {
  sendFrame(pcm: ArrayBuffer): void;
  /** Graceful close; flushes any pending final. */
  close(): void;
}

export interface SttAdapter {
  open(cb: SttCallbacks): Promise<SttSession>;
}
