/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `mock` (default) or `supabase` (Phase 5) — see src/integrations/data/index.ts */
  readonly VITE_DATA_ADAPTER?: 'mock' | 'supabase';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
