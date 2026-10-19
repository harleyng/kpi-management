import type { CollectionName } from '@/data/fixtures/types';
import type { OrgUnit } from '@/data/types';
import { KpiError } from '@/lib/errorCatalog';
import { wouldCreateUnitCycle } from '@/lib/orgRules';
import { REVERSE_REFS, SCHEMA, valuesAt, type CheckContext, type RefSpec } from './schema';
import { keyOf, type Row, type Tx } from './store';

/**
 * Enforces `schema.ts` on a transaction, at COMMIT (so a reorder of step numbers inside one save
 * never trips a unique index half-way). Every failure is a `KpiError`:
 * - a reference that does not resolve in the tenant → ERR-KPI-06, worded exactly like a missing id,
 *   so nothing ever hints that the id exists in another tenant;
 * - an `owner` / immutable column changed on update → ERR-KPI-06;
 * - a unique index or CHECK violated → ERR-KPI-06;
 * - a row removed while something still points at it under `restrict` → ERR-KPI-04.
 */

function checkContext(tx: Tx): CheckContext {
  return {
    find: (c, id) => tx.find(c, id) as unknown as Row | undefined,
    all: (c) => tx.all(c) as unknown as Row[],
  };
}

function exists(tx: Tx, to: RefSpec['to'], id: string): boolean {
  return to === 'Permission' ? tx.globals.permissions.has(id) : tx.find(to, id) !== undefined;
}

function invalid(detail: string): KpiError {
  return new KpiError('ERR-KPI-06', detail);
}

function validateRow(tx: Tx, c: CollectionName, before: Row | null, after: Row, ctx: CheckContext): void {
  const spec = SCHEMA[c];
  for (const r of spec.refs) {
    for (const id of valuesAt(after, r.path)) {
      if (!exists(tx, r.to, id)) throw invalid(`${c}.${r.path}: ${r.to} ${id} not found`);
    }
    if (before && r.kind === 'owner') {
      const was = valuesAt(before, r.path).join(',');
      const now = valuesAt(after, r.path).join(',');
      if (was !== now) throw invalid(`${c}.${r.path} cannot change`);
    }
    if (r.kind === 'hierarchy' && c === 'OrgUnit') {
      const units = tx.all('OrgUnit').filter((u) => u.id !== after.id);
      if (wouldCreateUnitCycle([...units, after as unknown as OrgUnit], after.id as string, after.parentId as string | null)) {
        throw invalid(`${c}.${r.path} would place the unit below itself`);
      }
    }
  }
  if (before) {
    for (const col of spec.immutable ?? []) {
      if (before[col] !== after[col]) throw invalid(`${c}.${col} cannot change`);
    }
  }
  for (const check of spec.checks ?? []) {
    const problem = check(after, ctx);
    if (problem) throw invalid(`${c}: ${problem}`);
  }
}

function validateCollection(tx: Tx, c: CollectionName): void {
  const spec = SCHEMA[c];
  const rows = tx.all(c) as unknown as Row[];
  for (const u of spec.unique ?? []) {
    const seen = new Set<string>();
    for (const row of rows) {
      if (u.where && !u.where(row)) continue;
      const k = JSON.stringify(u.fields.map((f) => row[f] ?? null));
      if (seen.has(k)) throw invalid(`${c}: duplicate (${u.fields.join(', ')}) = ${k}`);
      seen.add(k);
    }
  }
  for (const check of spec.collectionChecks ?? []) {
    const problem = check(rows);
    if (problem) throw invalid(`${c}: ${problem}`);
  }
}

/** Nothing left pointing at a removed row (cascades and set-null already ran in `removeRow`). */
function validateRemoved(tx: Tx, c: CollectionName, key: string): void {
  for (const { from, spec } of REVERSE_REFS.get(c) ?? []) {
    for (const row of tx.all(from) as unknown as Row[]) {
      if (valuesAt(row, spec.path).includes(key)) {
        throw new KpiError('ERR-KPI-04', `${c} ${key} is still referenced by ${from}.${spec.path}`);
      }
    }
  }
}

export function validateTransaction(tx: Tx): void {
  const ctx = checkContext(tx);
  const changes = tx.changes();
  for (const change of changes) {
    if (change.after) validateRow(tx, change.collection, change.before, change.after, ctx);
    else validateRemoved(tx, change.collection, change.key);
  }
  for (const c of new Set(changes.map((ch) => ch.collection))) validateCollection(tx, c);
}

/**
 * Deletes a row and applies every delete policy that points at it: `cascade` removes the
 * referencing rows (recursively), `setNull` clears the column, `restrict` refuses with ERR-KPI-04.
 */
export function removeRow(tx: Tx, c: CollectionName, key: string): void {
  tx.get(c, key);
  for (const { from, spec } of REVERSE_REFS.get(c) ?? []) {
    for (const row of tx.all(from) as unknown as Row[]) {
      if (!valuesAt(row, spec.path).includes(key)) continue;
      const rowKey = keyOf(from, row);
      if (from === c && rowKey === key) continue;
      if (spec.onDelete === 'cascade') {
        if (tx.find(from, rowKey)) removeRow(tx, from, rowKey);
      } else if (spec.onDelete === 'setNull' && !spec.path.includes('.') && !spec.path.includes('[]')) {
        tx.update(from, { ...row, [spec.path]: null } as never);
      } else {
        throw new KpiError('ERR-KPI-04', `${c} ${key} is still referenced by ${from}.${spec.path}`);
      }
    }
  }
  tx.delete(c, key);
}
