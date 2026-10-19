import type { CollectionName, RowOf } from '@/data/fixtures/types';
import type { Id } from '@/data/types';
import { KpiError } from '@/lib/errorCatalog';
import { removeRow } from './integrity';
import { SCHEMA } from './schema';
import type { Row, Tx } from './store';

/**
 * Row building shared by the group files. A payload contributes ONLY its collection's writable
 * columns (`schema.ts`); everything else — `id`, `tenantId`, status, timestamps, who did it — comes
 * from the stored row or from the method. So `{ ...fetchedRow, tenantId: other, status: 'Locked' }`
 * sent back by a screen is inert.
 */

export const newId = (): Id => crypto.randomUUID();

/** The payload's writable columns; a missing one is ERR-KPI-06 (a row always has every column). */
export function writableOf(c: CollectionName, input: object, skip: readonly string[] = []): Row {
  const out: Row = {};
  const source = input as Row;
  for (const col of SCHEMA[c].writable) {
    if (skip.includes(col)) continue;
    if (source[col] === undefined) throw new KpiError('ERR-KPI-06', `${c}.${col} is required`);
    out[col] = source[col];
  }
  return out;
}

export interface UpsertOptions<C extends CollectionName> {
  /** The gateway-owned columns of a NEW row. */
  create: () => Partial<RowOf<C>>;
  /** Gateway-owned columns to change on UPDATE (default: keep the stored ones). */
  update?: (stored: RowOf<C>) => Partial<RowOf<C>>;
}

/** `input.id` present → update that row (ERR-KPI-02 if it is not this tenant's); absent → create. */
export function upsert<C extends CollectionName>(
  tx: Tx,
  c: C,
  input: object & { id?: Id },
  options: UpsertOptions<C>,
): RowOf<C> {
  const fields = writableOf(c, input);
  if (input.id !== undefined) {
    const stored = tx.get(c, input.id);
    const row = { ...(stored as object), ...fields, ...(options.update?.(stored) ?? {}) } as RowOf<C>;
    return tx.update(c, row);
  }
  const row = { id: newId(), tenantId: tx.tenantId, ...fields, ...options.create() } as unknown as RowOf<C>;
  return tx.insert(c, row);
}

/**
 * Saves a parent's child list, MATCHED BY ID: a child with an `id` is updated in place (so rows
 * pointing at it stay valid), one without is created, a stored child missing from the list is
 * removed — refused with ERR-KPI-04 while anything references it. A child `id` that is not one of
 * this parent's children is ERR-KPI-06. `extra` adds gateway-owned columns (e.g. `stepNo`).
 */
export function saveChildren<C extends CollectionName>(
  tx: Tx,
  c: C,
  parentField: string,
  parentId: Id,
  inputs: readonly (object & { id?: Id })[],
  extra: (index: number) => Record<string, unknown> = () => ({}),
): RowOf<C>[] {
  const existing = new Map(
    (tx.all(c) as unknown as Row[]).filter((r) => r[parentField] === parentId).map((r) => [r.id as string, r]),
  );
  const keep = new Set<string>();
  const saved: RowOf<C>[] = [];
  inputs.forEach((input, index) => {
    const fields = writableOf(c, input);
    if (input.id !== undefined) {
      const stored = existing.get(input.id);
      if (!stored) throw new KpiError('ERR-KPI-06', `${c} ${input.id} is not a child of ${parentId}`);
      if (keep.has(input.id)) throw new KpiError('ERR-KPI-06', `${c} ${input.id} appears twice`);
      keep.add(input.id);
      saved.push(tx.update(c, { ...stored, ...fields, ...extra(index) } as unknown as RowOf<C>));
    } else {
      const row = { id: newId(), tenantId: tx.tenantId, [parentField]: parentId, ...fields, ...extra(index) };
      saved.push(tx.insert(c, row as unknown as RowOf<C>));
    }
  });
  for (const id of existing.keys()) if (!keep.has(id)) removeRow(tx, c, id);
  return saved;
}

/** Rows of `c` whose `field` equals `value`. */
export function whereEq<C extends CollectionName>(tx: Tx, c: C, field: keyof RowOf<C> & string, value: unknown): RowOf<C>[] {
  return tx.all(c).filter((r) => (r as unknown as Row)[field] === value);
}

/** Filter helper: an omitted list does not filter; an empty list matches nothing (contract rule 7). */
export function inList(list: readonly Id[] | undefined, value: Id | null): boolean {
  return list === undefined || (value !== null && list.includes(value));
}

/** Filter helper: an omitted value does not filter. */
export function eqOpt<T>(wanted: T | undefined, value: T): boolean {
  return wanted === undefined || wanted === value;
}
