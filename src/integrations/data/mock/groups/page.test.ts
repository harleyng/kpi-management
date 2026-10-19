import { describe, expect, it } from 'vitest';
import { paginate } from './page';

const rows = Array.from({ length: 6 }, (_, i) => ({ id: `id${i}`, at: `2027-04-0${i + 1}` }));
const all = (limit: number) => {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = paginate(rows, (r) => r.at, { limit, cursor });
    ids.push(...page.items.map((r) => r.id));
    if (page.nextCursor === null) return ids;
    cursor = page.nextCursor;
  }
};

describe('keyset pagination', () => {
  it('orders newest first and ends with a null cursor — also on an exact multiple of the limit', () => {
    expect(all(4)).toEqual(['id5', 'id4', 'id3', 'id2', 'id1', 'id0']);
    expect(paginate(rows, (r) => r.at, { limit: 3 }).nextCursor).not.toBeNull();
    const second = paginate(rows, (r) => r.at, { limit: 3, cursor: paginate(rows, (r) => r.at, { limit: 3 }).nextCursor as string });
    expect(second.items).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    expect(paginate(rows, (r) => r.at, { limit: 6 }).nextCursor).toBeNull();
  });

  it('an empty list is one empty page', () => {
    expect(paginate([] as { id: string }[], () => '', {})).toEqual({ items: [], nextCursor: null });
  });

  it('a row added between two reads neither repeats nor shifts the next page', () => {
    const first = paginate(rows, (r) => r.at, { limit: 2 });
    const grown = [...rows, { id: 'new', at: '2027-04-09' }];
    const next = paginate(grown, (r) => r.at, { limit: 2, cursor: first.nextCursor as string });
    expect(next.items.map((r) => r.id)).toEqual(['id3', 'id2']);
  });

  it('refuses a limit outside 1…500 or not a whole number', () => {
    for (const limit of [0, -1, 1.5, 501]) expect(() => paginate(rows, (r) => r.at, { limit })).toThrow(/ERR-KPI-06/);
  });
});
