import { COLLECTION_NAMES, type CollectionName, type RowOf } from '@/data/fixtures/types';
import type { AuditAction, Id, IsoDateTime, Permission, Tenant } from '@/data/types';
import { KpiError } from '@/lib/errorCatalog';
import type { DomainEvent } from '../types';

/**
 * In-memory tables, partitioned by tenant — the only place the mock keeps data.
 *
 * Rows are deep-FROZEN as they enter the store: a group function that mutated a row it read would
 * otherwise change the store without a transaction, an event or a save. Every change goes through a
 * `Tx`, which copies a collection on its first write and swaps it in only on commit.
 */

export type Row = Record<string, unknown>;

/** `RolePermission` has a composite key; every other row is keyed by `id`. */
export function keyOf(collection: CollectionName, row: Row): string {
  return collection === 'RolePermission' ? `${row.roleId as string}|${row.permissionId as string}` : (row.id as string);
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value) && !(value instanceof Blob)) {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

/** JSON-safe deep copy; Blobs are immutable and pass through by reference. */
export function cloneDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Blob) return value;
  if (Array.isArray(value)) return value.map(cloneDeep) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = cloneDeep(v);
  return out as T;
}

export type Table = Map<string, Row>;

export class TenantData {
  readonly collections = new Map<CollectionName, Table>();

  constructor(readonly tenantId: Id) {
    for (const c of COLLECTION_NAMES) this.collections.set(c, new Map());
  }

  static fromRows(tenantId: Id, rows: { [C in CollectionName]?: readonly Row[] }): TenantData {
    const data = new TenantData(tenantId);
    for (const c of COLLECTION_NAMES) {
      const table: Table = new Map();
      for (const row of rows[c] ?? []) {
        if (row.tenantId !== tenantId) {
          throw new KpiError('ERR-KPI-01', `stored ${c} row ${keyOf(c, row)} belongs to another tenant`);
        }
        table.set(keyOf(c, row), deepFreeze(cloneDeep(row)));
      }
      data.collections.set(c, table);
    }
    return data;
  }
}

/** The two collections shared by every tenant. */
export interface GlobalData {
  tenants: Map<Id, Tenant>;
  permissions: Map<Id, Permission>;
}

export interface Change {
  collection: CollectionName;
  key: string;
  before: Row | null;
  after: Row | null;
  /** Overrides the CREATE/UPDATE/DELETE the change implies (LOCK, UNLOCK). */
  action: AuditAction | null;
  reason: string | null;
}

/** A domain event as a group function raises it; the runtime adds id, tenant, time and actor. */
export type PendingEvent = DomainEvent extends infer E
  ? E extends DomainEvent
    ? Omit<E, 'id' | 'tenantId' | 'occurredAt' | 'actorUserId' | 'onBehalfOfUserId'>
    : never
  : never;

export interface TxContext {
  tenantId: Id;
  now: IsoDateTime;
  /** `null` for a system write. */
  actorUserId: Id | null;
}

export class Tx {
  private readonly working = new Map<CollectionName, Table>();
  private readonly changeByKey = new Map<string, Change>();
  readonly events: PendingEvent[] = [];

  constructor(
    readonly data: TenantData,
    readonly globals: GlobalData,
    readonly ctx: TxContext,
  ) {}

  get tenantId(): Id {
    return this.ctx.tenantId;
  }

  get now(): IsoDateTime {
    return this.ctx.now;
  }

  private table(c: CollectionName): Table {
    return this.working.get(c) ?? (this.data.collections.get(c) as Table);
  }

  private writable(c: CollectionName): Table {
    let table = this.working.get(c);
    if (!table) {
      table = new Map(this.data.collections.get(c));
      this.working.set(c, table);
    }
    return table;
  }

  all<C extends CollectionName>(c: C): RowOf<C>[] {
    return [...this.table(c).values()] as unknown as RowOf<C>[];
  }

  find<C extends CollectionName>(c: C, key: string): RowOf<C> | undefined {
    return this.table(c).get(key) as unknown as RowOf<C> | undefined;
  }

  /** The row, or ERR-KPI-02 — the same answer for a missing id and another tenant's id. */
  get<C extends CollectionName>(c: C, key: string): RowOf<C> {
    const row = this.find(c, key);
    if (!row) throw new KpiError('ERR-KPI-02', `${c} ${key} not found`);
    return row;
  }

  private record(c: CollectionName, key: string, before: Row | null, after: Row | null, action: AuditAction | null, reason: string | null) {
    const id = `${c}\u0000${key}`;
    const existing = this.changeByKey.get(id);
    if (existing) {
      existing.after = after;
      if (action) existing.action = action;
      if (reason !== null) existing.reason = reason;
      if (existing.before === null && existing.after === null) this.changeByKey.delete(id);
    } else this.changeByKey.set(id, { collection: c, key, before, after, action, reason });
  }

  insert<C extends CollectionName>(c: C, row: RowOf<C>): RowOf<C> {
    const r = row as unknown as Row;
    if (r.tenantId !== this.tenantId) throw new KpiError('ERR-KPI-06', `${c} row is not in tenant ${this.tenantId}`);
    const key = keyOf(c, r);
    const table = this.writable(c);
    if (table.has(key)) throw new KpiError('ERR-KPI-06', `${c} ${key} already exists`);
    const frozen = deepFreeze(cloneDeep(r));
    table.set(key, frozen);
    this.record(c, key, null, frozen, null, null);
    return frozen as unknown as RowOf<C>;
  }

  update<C extends CollectionName>(c: C, row: RowOf<C>, meta: { action?: AuditAction; reason?: string | null } = {}): RowOf<C> {
    const r = row as unknown as Row;
    const key = keyOf(c, r);
    const table = this.writable(c);
    const before = table.get(key);
    if (!before) throw new KpiError('ERR-KPI-02', `${c} ${key} not found`);
    if (r.tenantId !== this.tenantId) throw new KpiError('ERR-KPI-06', `${c} row is not in tenant ${this.tenantId}`);
    const frozen = deepFreeze(cloneDeep(r));
    table.set(key, frozen);
    this.record(c, key, before, frozen, meta.action ?? null, meta.reason ?? null);
    return frozen as unknown as RowOf<C>;
  }

  /** Raw delete — callers go through `integrity.removeRow`, which applies the delete policies. */
  delete(c: CollectionName, key: string): void {
    const table = this.writable(c);
    const before = table.get(key);
    if (!before) throw new KpiError('ERR-KPI-02', `${c} ${key} not found`);
    table.delete(key);
    this.record(c, key, before, null, null, null);
  }

  emit(event: PendingEvent): void {
    this.events.push(event);
  }

  changes(): Change[] {
    return [...this.changeByKey.values()];
  }

  /** Collections this transaction wrote, with their new contents. */
  touched(): [CollectionName, Table][] {
    return [...this.working.entries()];
  }

  /** Swap the working copies in. Only the runtime calls this, after validation and save. */
  apply(): void {
    for (const [c, table] of this.working) this.data.collections.set(c, table);
  }
}
