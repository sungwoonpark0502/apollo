/// <reference types="vite/client" />
declare module '*.css';

import type { ApolloBridge } from '@apollo/shared';

declare global {
  interface Window {
    apollo: ApolloBridge;
  }
}
