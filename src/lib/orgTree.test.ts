import { describe, expect, it } from 'vitest';
import {
  allTreeIds,
  ancestorIds,
  buildTree,
  pruneTree,
  treeKeyAction,
  visibleTreeRows,
  type TreeItem,
} from './orgTree';

const unit = (id: string, parentId: string | null, name = id): TreeItem => ({ id, parentId, name });

// company → { Khối Kinh doanh → { Phòng Đông, Phòng Bắc }, Khối Vận hành }
const units: TreeItem[] = [
  unit('kd-dong', 'kd', 'Phòng Đông'),
  unit('co', null, 'Syntra'),
  unit('vh', 'co', 'Khối Vận hành'),
  unit('kd', 'co', 'Khối Kinh doanh'),
  unit('kd-bac', 'kd', 'Phòng Bắc'),
];

const names = (rows: ReturnType<typeof visibleTreeRows>) => rows.map((r) => r.node.item.name);

describe('buildTree', () => {
  it('nests units under their parent, siblings sorted by Vietnamese name', () => {
    const [root] = buildTree(units);
    expect(root.item.id).toBe('co');
    expect(root.children.map((c) => c.item.name)).toEqual(['Khối Kinh doanh', 'Khối Vận hành']);
    expect(root.children[0].children.map((c) => c.item.name)).toEqual(['Phòng Bắc', 'Phòng Đông']);
  });

  it('makes an orphan (missing parent) a root instead of dropping it', () => {
    const roots = buildTree([unit('a', null), unit('lost', 'gone')]);
    expect(roots.map((r) => r.item.id).sort()).toEqual(['a', 'lost']);
  });

  it('breaks a parent cycle so every unit appears exactly once', () => {
    const roots = buildTree([unit('a', 'b'), unit('b', 'a'), unit('self', 'self')]);
    expect(allTreeIds(roots).sort()).toEqual(['a', 'b', 'self']);
  });
});

describe('visibleTreeRows', () => {
  const roots = buildTree(units);

  it('shows only the roots when nothing is expanded', () => {
    expect(names(visibleTreeRows(roots, new Set()))).toEqual(['Syntra']);
  });

  it('descends into expanded nodes only, with ARIA level / set size / position', () => {
    const rows = visibleTreeRows(roots, new Set(['co', 'kd']));
    expect(names(rows)).toEqual(['Syntra', 'Khối Kinh doanh', 'Phòng Bắc', 'Phòng Đông', 'Khối Vận hành']);
    const bac = rows[2];
    expect(bac).toMatchObject({ level: 3, parentId: 'kd', setSize: 2, posInSet: 1, hasChildren: false });
    expect(rows[1]).toMatchObject({ expanded: true, hasChildren: true });
  });

  it('never marks a leaf as expanded', () => {
    const rows = visibleTreeRows(roots, new Set(['co', 'vh']));
    expect(rows.find((r) => r.node.item.id === 'vh')?.expanded).toBe(false);
  });
});

describe('ancestorIds', () => {
  it('lists the ancestors nearest first', () => {
    expect(ancestorIds(units, 'kd-bac')).toEqual(['kd', 'co']);
    expect(ancestorIds(units, 'co')).toEqual([]);
  });

  it('terminates on a cycle', () => {
    expect(ancestorIds([unit('a', 'b'), unit('b', 'a')], 'a')).toEqual(['b']);
  });
});

describe('pruneTree', () => {
  it('keeps matches and the path to them', () => {
    const pruned = pruneTree(buildTree(units), (u) => u.name === 'Phòng Đông');
    expect(allTreeIds(pruned)).toEqual(['co', 'kd', 'kd-dong']);
  });

  it('returns nothing when nothing matches', () => {
    expect(pruneTree(buildTree(units), () => false)).toEqual([]);
  });
});

describe('treeKeyAction', () => {
  const rows = visibleTreeRows(buildTree(units), new Set(['co']));
  // Syntra, Khối Kinh doanh (collapsed), Khối Vận hành

  it('moves with the arrows and stops at the ends', () => {
    expect(treeKeyAction(rows, 'co', 'ArrowDown')).toEqual({ type: 'focus', id: 'kd' });
    expect(treeKeyAction(rows, 'kd', 'ArrowUp')).toEqual({ type: 'focus', id: 'co' });
    expect(treeKeyAction(rows, 'co', 'ArrowUp')).toBeNull();
    expect(treeKeyAction(rows, 'vh', 'ArrowDown')).toBeNull();
  });

  it('opens a closed node, then enters it', () => {
    expect(treeKeyAction(rows, 'kd', 'ArrowRight')).toEqual({ type: 'expand', id: 'kd' });
    expect(treeKeyAction(rows, 'co', 'ArrowRight')).toEqual({ type: 'focus', id: 'kd' });
    expect(treeKeyAction(rows, 'vh', 'ArrowRight')).toBeNull();
  });

  it('closes an open node, else goes to the parent', () => {
    expect(treeKeyAction(rows, 'co', 'ArrowLeft')).toEqual({ type: 'collapse', id: 'co' });
    expect(treeKeyAction(rows, 'kd', 'ArrowLeft')).toEqual({ type: 'focus', id: 'co' });
  });

  it('jumps with Home/End and selects with Enter/Space', () => {
    expect(treeKeyAction(rows, 'kd', 'Home')).toEqual({ type: 'focus', id: 'co' });
    expect(treeKeyAction(rows, 'co', 'End')).toEqual({ type: 'focus', id: 'vh' });
    expect(treeKeyAction(rows, 'kd', 'Enter')).toEqual({ type: 'select', id: 'kd' });
    expect(treeKeyAction(rows, 'kd', ' ')).toEqual({ type: 'select', id: 'kd' });
  });

  it('ignores other keys and an unknown focus', () => {
    expect(treeKeyAction(rows, 'co', 'a')).toBeNull();
    expect(treeKeyAction(rows, 'nope', 'ArrowDown')).toBeNull();
  });
});
