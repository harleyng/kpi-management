/**
 * The org tree as data — built from the flat `OrgUnit` list (self-referencing `parentId`) and
 * flattened for an ARIA tree. Pure and tested, so `OrgUnitTree` only renders and listens to keys.
 *
 * The seed should hold exactly one root per tenant, but the tree must never lose or loop on a
 * malformed one: an orphan (its parent is missing) becomes a root, and a parent cycle is broken
 * at the first unit reached — every unit appears exactly once.
 */

export interface TreeItem {
  id: string;
  parentId: string | null;
  name: string;
}

export interface TreeNode<T extends TreeItem> {
  item: T;
  children: TreeNode<T>[];
}

/** One rendered row of the flattened tree (WAI-ARIA tree: level, set size, position). */
export interface TreeRow<T extends TreeItem> {
  node: TreeNode<T>;
  /** 1-based, as `aria-level`. */
  level: number;
  parentId: string | null;
  setSize: number;
  /** 1-based, as `aria-posinset`. */
  posInSet: number;
  hasChildren: boolean;
  expanded: boolean;
}

const collator = new Intl.Collator('vi', { sensitivity: 'base', numeric: true });
const byName = <T extends TreeItem>(a: TreeNode<T>, b: TreeNode<T>) => collator.compare(a.item.name, b.item.name);

export function buildTree<T extends TreeItem>(items: readonly T[]): TreeNode<T>[] {
  const ids = new Set(items.map((i) => i.id));
  const childrenOf = new Map<string, T[]>();
  for (const item of items) {
    if (item.parentId && ids.has(item.parentId) && item.parentId !== item.id) {
      const list = childrenOf.get(item.parentId);
      if (list) list.push(item);
      else childrenOf.set(item.parentId, [item]);
    }
  }

  const visited = new Set<string>();
  const grow = (item: T): TreeNode<T> => {
    visited.add(item.id);
    const children = (childrenOf.get(item.id) ?? []).filter((c) => !visited.has(c.id)).map(grow);
    return { item, children: children.sort(byName) };
  };

  const isRoot = (i: T) => !i.parentId || !ids.has(i.parentId) || i.parentId === i.id;
  const roots = items.filter(isRoot).map(grow);
  // Whatever is still unvisited sits on a parent cycle: break it there.
  for (const item of items) if (!visited.has(item.id)) roots.push(grow(item));
  return roots.sort(byName);
}

/** The rows on screen: depth-first, descending only into expanded nodes. */
export function visibleTreeRows<T extends TreeItem>(
  roots: readonly TreeNode<T>[],
  expanded: ReadonlySet<string>,
): TreeRow<T>[] {
  const rows: TreeRow<T>[] = [];
  const walk = (nodes: readonly TreeNode<T>[], level: number, parentId: string | null) => {
    nodes.forEach((node, index) => {
      const hasChildren = node.children.length > 0;
      const isOpen = hasChildren && expanded.has(node.item.id);
      rows.push({
        node,
        level,
        parentId,
        setSize: nodes.length,
        posInSet: index + 1,
        hasChildren,
        expanded: isOpen,
      });
      if (isOpen) walk(node.children, level + 1, node.item.id);
    });
  };
  walk(roots, 1, null);
  return rows;
}

/** Every ancestor of `id`, nearest first — to open the tree down to a selected unit. Cycle-safe. */
export function ancestorIds(items: readonly TreeItem[], id: string): string[] {
  const parentOf = new Map(items.map((i) => [i.id, i.parentId]));
  const out: string[] = [];
  const seen = new Set([id]);
  let current = parentOf.get(id) ?? null;
  while (current && parentOf.has(current) && !seen.has(current)) {
    out.push(current);
    seen.add(current);
    current = parentOf.get(current) ?? null;
  }
  return out;
}

/** Every id in the tree — to open everything while a search is narrowing it. */
export function allTreeIds<T extends TreeItem>(roots: readonly TreeNode<T>[]): string[] {
  return roots.flatMap((node) => [node.item.id, ...allTreeIds(node.children)]);
}

/** Keep the nodes that match, and the ancestors that lead to them. */
export function pruneTree<T extends TreeItem>(
  roots: readonly TreeNode<T>[],
  matches: (item: T) => boolean,
): TreeNode<T>[] {
  return roots.flatMap((node) => {
    const children = pruneTree(node.children, matches);
    return matches(node.item) || children.length > 0 ? [{ item: node.item, children }] : [];
  });
}

export type TreeKeyAction =
  | { type: 'focus'; id: string }
  | { type: 'expand'; id: string }
  | { type: 'collapse'; id: string }
  | { type: 'select'; id: string };

/**
 * The WAI-ARIA tree keyboard model: ↑/↓ move, → opens (or enters an open node), ← closes (or goes
 * to the parent), Home/End jump, Enter/Space select. `null` = the key is not the tree's.
 */
export function treeKeyAction<T extends TreeItem>(
  rows: readonly TreeRow<T>[],
  focusedId: string,
  key: string,
): TreeKeyAction | null {
  const index = rows.findIndex((r) => r.node.item.id === focusedId);
  if (index === -1 || rows.length === 0) return null;
  const row = rows[index];
  const focus = (i: number): TreeKeyAction => ({ type: 'focus', id: rows[i].node.item.id });

  switch (key) {
    case 'ArrowDown':
      return index < rows.length - 1 ? focus(index + 1) : null;
    case 'ArrowUp':
      return index > 0 ? focus(index - 1) : null;
    case 'Home':
      return focus(0);
    case 'End':
      return focus(rows.length - 1);
    case 'ArrowRight':
      if (!row.hasChildren) return null;
      return row.expanded ? focus(index + 1) : { type: 'expand', id: focusedId };
    case 'ArrowLeft':
      if (row.expanded) return { type: 'collapse', id: focusedId };
      return row.parentId ? { type: 'focus', id: row.parentId } : null;
    case 'Enter':
    case ' ':
      return { type: 'select', id: focusedId };
    default:
      return null;
  }
}
