import { COLLECTION_NAMES, type CollectionName, type Seed } from '@/data/fixtures/types';
import type { AuditAction, EntityName, Id, IsoDateTime, Tenant } from '@/data/types';
import { KpiDeferredError, KpiError } from '@/lib/errorCatalog';
import type { DomainEvent, RowSnapshot } from '../types';
import { auditRowOf, NOT_AUDITED } from './audit';
import { authorizeActor } from './authorize';
import { createBus, type DiagnosticSink, type EventBus } from './bus';
import { createSimClock, type SimClock } from './clock';
import { validateTransaction } from './integrity';
import { CLOCK_KEY, Persistence, type LoadedData, type StorageLike } from './persistence';
import { cloneDeep, TenantData, Tx, type Change, type GlobalData, type Row, type Table } from './store';

/**
 * The per-call machinery every mock method runs through — one place for latency, failure
 * injection, input/output copying, the tenant check, authorization, the transaction, integrity,
 * the save and the events. Group files only describe WHAT a method does.
 *
 * Write bodies are synchronous: from `new Tx` to `apply()` nothing awaits, so two concurrent writes
 * can never interleave and lose an update (JavaScript runs one at a time).
 */

export type MethodKind = 'read' | 'write' | 'system' | 'platform';

export interface RuntimeOptions {
  storage: StorageLike | null;
  latencyMs: number;
  seed: () => Seed;
  seedVersion: string;
  seedNow: IsoDateTime;
  realNow?: () => number;
  onDiagnostic: DiagnosticSink;
}

export interface Registry {
  /** Every method, by `group.method`, with the wrapper that classifies it. */
  methods: Map<string, MethodKind>;
  /** Methods that reject `KpiDeferredError` until their rule is wired → what they wait for. */
  deferred: Map<string, string>;
  /** Methods that work but whose refusal rule is not wired yet → the rule. */
  pendingGuards: Map<string, string>;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** Row snapshots in events and the audit log are JSON (`JsonValue`), never live objects. */
const snapshot = (row: Row | null): RowSnapshot | null => (row === null ? null : (JSON.parse(JSON.stringify(row)) as RowSnapshot));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class Runtime {
  readonly registry: Registry = { methods: new Map(), deferred: new Map(), pendingGuards: new Map() };
  readonly persistence: Persistence;
  readonly clock: SimClock;
  readonly bus: EventBus;
  /** Uploaded file contents, by `tenantId/fileId` — memory only (a reload loses them). */
  readonly blobs = new Map<string, Blob>();
  latencyMs: number;
  private failure: { enabled: boolean; pattern: RegExp | null } = { enabled: false, pattern: null };
  private globals: GlobalData = { tenants: new Map(), permissions: new Map() };
  private tenants = new Map<Id, TenantData>();
  private loaded = false;

  constructor(private readonly options: RuntimeOptions) {
    this.persistence = new Persistence(options.storage);
    this.clock = createSimClock({ seedNow: options.seedNow, persistence: this.persistence, realNow: options.realNow, onDiagnostic: options.onDiagnostic });
    this.bus = createBus(options.onDiagnostic);
    this.latencyMs = options.latencyMs;
  }

  // ─── Data lifecycle ──────────────────────────────────────────────────────────────────────────

  private install(data: LoadedData): void {
    this.globals = {
      tenants: new Map(data.tenants.map((t) => [t.id, t])),
      permissions: new Map(data.permissions.map((p) => [p.id, p])),
    };
    this.tenants = new Map();
    for (const t of data.tenants) this.tenants.set(t.id, TenantData.fromRows(t.id, data.tables.get(t.id) ?? {}));
    this.loaded = true;
  }

  private seedData(): LoadedData {
    const seed = this.options.seed();
    return {
      tenants: seed.tenants.map((t) => t.tenant),
      permissions: seed.permissions,
      tables: new Map(seed.tenants.map((t) => [t.tenant.id, t.rows as unknown as { [C in CollectionName]?: Row[] }])),
    };
  }

  /** Loads storage on first use; reseeds when nothing is stored or the seed version changed. */
  private ensureLoaded(): void {
    if (this.loaded) return;
    try {
      const storedVersion = this.persistence.readSeedVersion();
      const stored = storedVersion === this.options.seedVersion ? this.persistence.load() : null;
      if (stored) {
        this.install(stored);
        return;
      }
      const fresh = this.seedData();
      this.persistence.wipe();
      // An OLDER seed's simulated time belongs to its story; a first load keeps any setNow already made.
      if (storedVersion !== null) this.clock.reset();
      this.persistence.saveAll(fresh, this.options.seedVersion);
      this.install(fresh);
    } catch (error) {
      this.loaded = false;
      if (error instanceof KpiError && error.code === 'ERR-KPI-01') throw error;
      throw new KpiError('ERR-KPI-01', `mock storage could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** `dev.resetSeed()` — wipe storage and memory together, reload the fixtures, emit nothing. */
  resetSeed(): void {
    const fresh = this.seedData();
    this.persistence.wipe();
    this.blobs.clear();
    this.clock.reset();
    this.persistence.saveAll(fresh, this.options.seedVersion);
    this.install(fresh);
  }

  setFailureMode(mode: { enabled: boolean; methodPattern?: string }): void {
    this.failure = { enabled: mode.enabled, pattern: mode.methodPattern ? globToRegExp(mode.methodPattern) : null };
  }

  tenantData(tenantId: Id): TenantData {
    this.ensureLoaded();
    const data = typeof tenantId === 'string' ? this.tenants.get(tenantId) : undefined;
    if (!data) throw new KpiError('ERR-KPI-02', `tenant ${String(tenantId)} not found`);
    return data;
  }

  allTenants(): Tenant[] {
    this.ensureLoaded();
    return [...this.globals.tenants.values()];
  }

  // ─── Wrappers ────────────────────────────────────────────────────────────────────────────────

  private register(name: string, kind: MethodKind): void {
    this.registry.methods.set(name, kind);
  }

  private async preamble(name: string, kind: MethodKind): Promise<void> {
    if (this.latencyMs > 0) await sleep(this.latencyMs);
    if (this.failure.enabled && (this.failure.pattern === null || this.failure.pattern.test(name))) {
      throw new KpiError(kind === 'read' ? 'ERR-KPI-01' : 'ERR-KPI-03', `injected failure: ${name}`);
    }
  }

  private mapError(error: unknown, kind: MethodKind, name: string): KpiError {
    if (error instanceof KpiError) return error;
    const detail = `${name}: ${error instanceof Error ? error.message : String(error)}`;
    return new KpiError(kind === 'read' ? 'ERR-KPI-01' : 'ERR-KPI-03', detail);
  }

  private newTx(tenantId: Id, actorUserId: Id | null): Tx {
    const data = this.tenantData(tenantId);
    return new Tx(data, this.globals, { tenantId, now: this.clock.now(), actorUserId });
  }

  /**
   * Events → audit rows (same transaction) → validate → save (tables AND the clock in one
   * all-or-nothing batch) → swap in. Nothing after the save can fail, so a write is either reported
   * failed and absent, or saved and announced — never saved and reported failed. Returns the events
   * to emit; the caller emits them after.
   */
  private commit(tx: Tx, onBehalfOfUserId: Id | null = null): DomainEvent[] {
    const events = this.eventsOf(tx, onBehalfOfUserId);
    for (const event of events) {
      if (event.type === 'entity.changed' && !NOT_AUDITED.has(event.entityName)) tx.insert('AuditLog', auditRowOf(event));
    }
    validateTransaction(tx);
    const touched = tx.touched();
    if (touched.length > 0) {
      this.persistence.saveTables(
        tx.tenantId,
        touched.map(([c, table]) => [c, table.values()]),
        [[CLOCK_KEY, this.clock.serialize()]],
      );
    }
    tx.apply();
    return events;
  }

  private eventsOf(tx: Tx, onBehalfOfUserId: Id | null): DomainEvent[] {
    const base = { tenantId: tx.tenantId, occurredAt: tx.now, actorUserId: tx.ctx.actorUserId, onBehalfOfUserId };
    const events: DomainEvent[] = [];
    for (const change of tx.changes()) {
      if (change.collection === 'AuditLog') continue; // the audit log is not itself audited
      events.push({
        id: crypto.randomUUID(),
        ...base,
        type: 'entity.changed',
        entityName: change.collection as EntityName,
        entityId: change.key,
        action: actionOf(change),
        before: snapshot(change.before),
        after: snapshot(change.after),
        reason: change.reason,
      });
    }
    for (const pending of tx.events) events.push({ id: crypto.randomUUID(), ...base, ...pending } as DomainEvent);
    return events;
  }

  /** A tenant-scoped read: `(tenantId, ...args)`. */
  read<A extends unknown[], R>(name: string, body: (tx: Tx, ...args: A) => R): (tenantId: Id, ...args: A) => Promise<R> {
    this.register(name, 'read');
    return async (tenantId, ...args) => {
      const input = cloneDeep(args);
      try {
        await this.preamble(name, 'read');
        return cloneDeep(body(this.newTx(tenantId, null), ...input));
      } catch (error) {
        throw this.mapError(error, 'read', name);
      }
    };
  }

  /** A user write: `(tenantId, actorUserId, ...args)`. */
  write<A extends unknown[], R>(
    name: string,
    body: (tx: Tx, ...args: A) => R,
  ): (tenantId: Id, actorUserId: Id, ...args: A) => Promise<R> {
    this.register(name, 'write');
    return async (tenantId, actorUserId, ...args) => {
      const input = cloneDeep(args);
      let events: DomainEvent[];
      let result: R;
      try {
        await this.preamble(name, 'write');
        const tx = this.newTx(tenantId, actorUserId);
        authorizeActor(tx, actorUserId);
        result = body(tx, ...input);
        events = this.commit(tx);
      } catch (error) {
        throw this.mapError(error, 'write', name);
      }
      this.bus.emit(events);
      return cloneDeep(result);
    };
  }

  /** A system write (T7's listeners): `(tenantId, ...args)`, no actor. */
  system<A extends unknown[], R>(name: string, body: (tx: Tx, ...args: A) => R): (tenantId: Id, ...args: A) => Promise<R> {
    this.register(name, 'system');
    return async (tenantId, ...args) => {
      const input = cloneDeep(args);
      let events: DomainEvent[];
      let result: R;
      try {
        await this.preamble(name, 'system');
        const tx = this.newTx(tenantId, null);
        result = body(tx, ...input);
        events = this.commit(tx);
      } catch (error) {
        throw this.mapError(error, 'system', name);
      }
      this.bus.emit(events);
      return cloneDeep(result);
    };
  }

  /** A method whose result a rule computes, and the rule is not wired yet. */
  deferred(name: string, kind: 'read' | 'write', owner: string): (...args: unknown[]) => Promise<never> {
    this.register(name, kind);
    this.registry.deferred.set(name, owner);
    return async () => {
      await this.preamble(name, kind);
      throw new KpiDeferredError(kind, name, owner);
    };
  }

  /** Records that `name` works but its refusal rule `rule` is not wired yet. */
  pendingGuard(name: string, rule: string): void {
    this.registry.pendingGuards.set(name, rule);
  }

  // ─── Platform (the tenant list itself) ───────────────────────────────────────────────────────

  platformRead<A extends unknown[], R>(name: string, body: (globals: GlobalData, ...args: A) => R): (...args: A) => Promise<R> {
    this.register(name, 'platform');
    return async (...args) => {
      const input = cloneDeep(args);
      try {
        await this.preamble(name, 'read');
        this.ensureLoaded();
        return cloneDeep(body(this.globals, ...input));
      } catch (error) {
        throw this.mapError(error, 'read', name);
      }
    };
  }

  /**
   * A tenant write. The tenant row is global, so it is saved apart from the tables; the event and
   * the audit entry go to that tenant's own log, and name the actor only when they belong to it.
   */
  saveTenant(name: string): (actorUserId: Id, input: Omit<Tenant, 'id' | 'createdAt'> & { id?: Id }) => Promise<Tenant> {
    this.register(name, 'platform');
    return async (actorUserId, rawInput) => {
      const input = cloneDeep(rawInput);
      let events: DomainEvent[];
      let saved: Tenant;
      try {
        await this.preamble(name, 'write');
        this.ensureLoaded();
        const home = [...this.tenants.values()].find((t) => t.collections.get('UserAccount')?.get(actorUserId)?.status === 'Active');
        if (!home) throw new KpiError('ERR-KPI-05', `user ${String(actorUserId)} cannot act here`);
        const now = this.clock.now();
        const existing = input.id === undefined ? null : (this.globals.tenants.get(input.id) ?? null);
        if (input.id !== undefined && !existing) throw new KpiError('ERR-KPI-02', `tenant ${input.id} not found`);
        if (existing && home.tenantId !== existing.id) throw new KpiError('ERR-KPI-05', `user ${actorUserId} cannot act here`);
        for (const col of ['code', 'name', 'timezone', 'status'] as const) {
          if (input[col] === undefined) throw new KpiError('ERR-KPI-06', `Tenant.${col} is required`);
        }
        saved = {
          id: existing?.id ?? crypto.randomUUID(),
          code: input.code,
          name: input.name,
          timezone: input.timezone,
          status: input.status,
          createdAt: existing?.createdAt ?? now,
        };
        if ([...this.globals.tenants.values()].some((t) => t.id !== saved.id && t.code === saved.code)) {
          throw new KpiError('ERR-KPI-06', `Tenant: duplicate code ${saved.code}`);
        }
        const next = new Map(this.globals.tenants);
        next.set(saved.id, saved);
        const data = this.tenants.get(saved.id) ?? new TenantData(saved.id);
        events = [
          {
            id: crypto.randomUUID(),
            tenantId: saved.id,
            occurredAt: now,
            actorUserId: home.tenantId === saved.id ? actorUserId : null,
            onBehalfOfUserId: null,
            type: 'entity.changed',
            entityName: 'Tenant',
            entityId: saved.id,
            action: existing ? 'UPDATE' : 'CREATE',
            before: existing ? snapshot(existing as unknown as Row) : null,
            after: snapshot(saved as unknown as Row),
            reason: null,
          },
        ];
        // The tenant row, the tenant's own audit entry (and, for a new tenant, its empty tables) and
        // the clock are saved together, like any other write.
        const tx = new Tx(data, { ...this.globals, tenants: next }, { tenantId: saved.id, now, actorUserId: null });
        tx.insert('AuditLog', auditRowOf(events[0] as Extract<DomainEvent, { type: 'entity.changed' }>));
        validateTransaction(tx);
        const touched = new Map(tx.touched());
        // A new tenant writes every table (empty but present), so a later load finds all its keys.
        const collections = existing ? [...touched.keys()] : COLLECTION_NAMES;
        const tables = collections.map((c) => [c, (touched.get(c) ?? (data.collections.get(c) as Table)).values()] as [CollectionName, Iterable<Row>]);
        this.persistence.saveTenantWrite(next.values(), saved.id, tables, [[CLOCK_KEY, this.clock.serialize()]]);
        tx.apply();
        this.globals.tenants = next;
        this.tenants.set(saved.id, data);
      } catch (error) {
        throw this.mapError(error, 'write', name);
      }
      this.bus.emit(events);
      return cloneDeep(saved);
    };
  }
}

function actionOf(change: Change): AuditAction {
  if (change.action) return change.action;
  if (change.before === null) return 'CREATE';
  if (change.after === null) return 'DELETE';
  return 'UPDATE';
}
