import type { AccountCredential } from '../account-access';

/** Tokens and verifier/state remain in the main process. A pending poll is null. */
export interface LoginFlow {
  url: string;
  userCode?: string;
  instructions?: string;
  expiresAt: number;
  intervalSeconds: number;
  poll(): Promise<AccountCredential | null>;
  submit?(code: string): Promise<void>;
  open?(): Promise<void>;
  cancel(): void;
}

export interface LoginOptions {
  fetch: typeof globalThis.fetch;
  now: () => number;
  signal?: AbortSignal;
  openWindow?: (url: string, options: { allowedOrigins: string[]; title: string }) => Promise<LoginWindow>;
}

/** Isolated provider window. Only main-process fixed scripts may inspect the
 * selected provider origin; credential results never reach the application UI. */
export interface LoginWindow {
  evaluate<T>(script: string): Promise<T | null>;
  closed(): boolean;
  close(): void;
}
