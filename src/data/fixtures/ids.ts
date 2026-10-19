/**
 * Deterministic, UUID-shaped ids for the seed (decision D-e, Phase 1.2).
 *
 * `seedId('syntra', 'Employee', 'E016')` is the same string on every load and every machine, so a
 * reload never produces a second seed, tests can name rows by a readable key, and the value is still
 * a valid `uuid` for the database later (version nibble `8` = "custom", RFC 9562). Never use
 * `crypto.randomUUID()` in a fixture.
 */

/** 32-bit FNV-1a. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const hex8 = (n: number) => n.toString(16).padStart(8, '0');

/** A stable id from readable parts: tenant key, entity, then any natural key. */
export function seedId(...parts: string[]): string {
  const key = parts.join('|');
  const h = [0, 1, 2, 3].map((salt) => hex8(fnv1a(`${salt}:${key}`))).join('');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Binds the tenant key once: `const id = idsFor('syntra'); id('Goal', 'E016', '1')`. */
export function idsFor(tenantKey: string) {
  return (entity: string, ...key: (string | number)[]) => seedId(tenantKey, entity, ...key.map(String));
}
