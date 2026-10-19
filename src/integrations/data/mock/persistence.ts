import { COLLECTION_NAMES, type CollectionName } from '@/data/fixtures/types';
import type { Id, Permission, Tenant } from '@/data/types';
import { KpiError } from '@/lib/errorCatalog';
import type { Row } from './store';

/**
 * localStorage layout of the mock (one key per tenant per collection, so a write re-serialises only
 * what it touched):
 *
 *   kpi.meta                        { seedVersion }
 *   kpi.clock                       { simulatedAt }        — the simulated clock (clock.ts)
 *   kpi.global.Tenant / .Permission JSON arrays
 *   kpi.t.<tenantId>.<Collection>   JSON array
 *
 * Saving is all-or-nothing across keys: the previous strings are remembered and restored if any
 * `setItem` throws (quota), and the caller then rejects ERR-KPI-03 with memory untouched — after a
 * reload, storage and what the user last saw agree. Multi-tab sync is not handled (one tab per demo).
 */

/** The part of `Storage` the mock uses — `window.localStorage` in the app, `MemoryStorage` in tests. */
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** An in-memory `Storage` for tests, with an optional quota (in characters) and a failure hook. */
export class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();
  /** Throw on `setItem` of these keys (or when the predicate says so). */
  failOn: ((key: string) => boolean) | null = null;

  constructor(private readonly quotaChars: number | null = null) {}

  get length() {
    return this.map.size;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failOn?.(key)) throw new DOMException('Simulated storage failure', 'QuotaExceededError');
    if (this.quotaChars !== null) {
      const used = [...this.map.entries()].reduce((sum, [k, v]) => sum + (k === key ? 0 : k.length + v.length), 0);
      if (used + key.length + value.length > this.quotaChars) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    }
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}

const PREFIX = 'kpi.';
export const META_KEY = 'kpi.meta';
export const CLOCK_KEY = 'kpi.clock';
const TENANTS_KEY = 'kpi.global.Tenant';
const PERMISSIONS_KEY = 'kpi.global.Permission';
const tableKey = (tenantId: Id, c: CollectionName) => `kpi.t.${tenantId}.${c}`;

export interface LoadedData {
  tenants: Tenant[];
  permissions: Permission[];
  tables: Map<Id, { [C in CollectionName]?: Row[] }>;
}

export class Persistence {
  constructor(private readonly storage: StorageLike | null) {}

  get enabled(): boolean {
    return this.storage !== null;
  }

  readSeedVersion(): string | null {
    const raw = this.storage?.getItem(META_KEY);
    if (!raw) return null;
    try {
      return (JSON.parse(raw) as { seedVersion?: string }).seedVersion ?? null;
    } catch {
      return null;
    }
  }

  /** Everything stored, or `null` when nothing is. A corrupt key fails loudly (ERR-KPI-01). */
  load(): LoadedData | null {
    const s = this.storage;
    if (!s) return null;
    const read = <T>(key: string): T | null => {
      const raw = s.getItem(key);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        throw new KpiError('ERR-KPI-01', `stored key ${key} is not valid JSON`);
      }
    };
    const tenants = read<Tenant[]>(TENANTS_KEY);
    if (!tenants) return null;
    // Every key a save writes must be there: a key missing (evicted, cleared by hand) would otherwise
    // show as an empty table — the failure that looks like "no data yet".
    const required = <T>(key: string): T => {
      const value = read<T>(key);
      if (value === null) throw new KpiError('ERR-KPI-01', `stored key ${key} is missing — reset the seed`);
      return value;
    };
    const tables = new Map<Id, { [C in CollectionName]?: Row[] }>();
    for (const t of tenants) {
      const rows: { [C in CollectionName]?: Row[] } = {};
      for (const c of COLLECTION_NAMES) rows[c] = required<Row[]>(tableKey(t.id, c));
      tables.set(t.id, rows);
    }
    return { tenants, permissions: required<Permission[]>(PERMISSIONS_KEY), tables };
  }

  /** Writes every entry or none of them (best-effort restore of the previous strings). */
  private writeAll(entries: readonly [string, string][]): void {
    const s = this.storage;
    if (!s) return;
    const previous = entries.map(([key]) => [key, s.getItem(key)] as const);
    try {
      for (const [key, value] of entries) s.setItem(key, value);
    } catch (error) {
      for (const [key, value] of previous) {
        try {
          if (value === null) s.removeItem(key);
          else s.setItem(key, value);
        } catch {
          // Restoring a string that fitted before should fit again; nothing more can be done here.
        }
      }
      throw new KpiError('ERR-KPI-03', `storage write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** A write: its tables plus any extra keys (the clock), all or none. */
  saveTables(tenantId: Id, tables: readonly [CollectionName, Iterable<Row>][], extra: readonly [string, string][] = []): void {
    this.writeAll([...tables.map(([c, rows]) => [tableKey(tenantId, c), JSON.stringify([...rows])] as [string, string]), ...extra]);
  }

  /** A tenant write: the tenant list, that tenant's tables, the extra keys — all or none. */
  saveTenantWrite(tenants: Iterable<Tenant>, tenantId: Id, tables: readonly [CollectionName, Iterable<Row>][], extra: readonly [string, string][]): void {
    this.writeAll([
      [TENANTS_KEY, JSON.stringify([...tenants])],
      ...tables.map(([c, rows]) => [tableKey(tenantId, c), JSON.stringify([...rows])] as [string, string]),
      ...extra,
    ]);
  }

  /** The whole data set at once (seed / reseed), with the seed version. */
  saveAll(data: LoadedData, seedVersion: string): void {
    const entries: [string, string][] = [
      [TENANTS_KEY, JSON.stringify(data.tenants)],
      [PERMISSIONS_KEY, JSON.stringify(data.permissions)],
    ];
    for (const [tenantId, rows] of data.tables) {
      for (const c of COLLECTION_NAMES) entries.push([tableKey(tenantId, c), JSON.stringify(rows[c] ?? [])]);
    }
    entries.push([META_KEY, JSON.stringify({ seedVersion })]);
    this.writeAll(entries);
  }

  /** Removes every `kpi.*` key. A failure throws — a half-wiped store must never look reset. */
  wipe(): void {
    const s = this.storage;
    if (!s) return;
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) s.removeItem(key);
  }

  getRaw(key: string): string | null {
    return this.storage?.getItem(key) ?? null;
  }

  setRaw(key: string, value: string | null): void {
    if (!this.storage) return;
    if (value === null) this.storage.removeItem(key);
    else this.storage.setItem(key, value);
  }
}
