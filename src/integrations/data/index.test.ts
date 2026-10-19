import { describe, expect, it } from 'vitest';
import { resolveAdapterName } from './index';
import { createSupabaseGateway } from './supabaseGateway';

describe('resolveAdapterName', () => {
  it('defaults to the mock when the variable is unset or empty', () => {
    expect(resolveAdapterName(undefined)).toBe('mock');
    expect(resolveAdapterName('')).toBe('mock');
    expect(resolveAdapterName('mock')).toBe('mock');
  });

  it('accepts the database adapter by name', () => {
    expect(resolveAdapterName('supabase')).toBe('supabase');
  });

  it('refuses an unknown value instead of silently serving the mock', () => {
    expect(() => resolveAdapterName('postgres')).toThrow(/Unknown VITE_DATA_ADAPTER/);
  });
});

describe('createSupabaseGateway', () => {
  it('fails loudly until Phase 5 rather than returning empty data', () => {
    expect(() => createSupabaseGateway()).toThrow(/not implemented/);
  });
});
