import '@testing-library/jest-dom/vitest';

// Node ≥ 22 ships an experimental global `localStorage` / `sessionStorage` that is `undefined` unless
// Node runs with `--localstorage-file`, and its getter shadows jsdom's. Put jsdom's back, so store
// tests exercise the same Web Storage the browser has (common-pitfalls.md).
const jsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window;
if (jsdomWindow) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    // Node's is an accessor; reading it would print an ExperimentalWarning in every worker.
    if (Object.getOwnPropertyDescriptor(globalThis, key)?.get) {
      Object.defineProperty(globalThis, key, { value: jsdomWindow[key], configurable: true, writable: true });
    }
  }
}
