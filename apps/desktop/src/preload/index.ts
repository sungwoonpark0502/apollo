import { contextBridge } from 'electron';

// Placeholder bridge; the full typed channel table lands in milestone 0.2.
const apollo = {
  appName: 'Apollo',
} as const;

contextBridge.exposeInMainWorld('apollo', apollo);

export type ApolloBridge = typeof apollo;
