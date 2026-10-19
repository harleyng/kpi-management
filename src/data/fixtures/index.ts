import { permissionRows } from '@/lib/permissionRules';
import { buildDemoCo, DEMO_TENANT_ID, demoId } from './demoCo';
import { buildSyntra, SYNTRA_TENANT_ID, syntraId } from './syntra';
import type { Seed } from './types';

/**
 * The seed `resetSeed()` loads — the CONTRACT between the Phase 2 tracks (README). Deterministic:
 * two calls return deep-equal data (no random ids, no clock reads).
 *
 * Bump SEED_VERSION whenever the fixtures change: a browser holding an older copy then reseeds on
 * its next load instead of mixing old rows with new code.
 */
export const SEED_VERSION = '2027-04-06.G1';
export { LAST_SCHEDULER_TICK, SEED_NOW } from './timeline';

export function buildSeed(): Seed {
  return { permissions: permissionRows(), tenants: [buildSyntra(), buildDemoCo()] };
}

/** Readable handles on seeded ids, for tests and for the tracks' own fixtures. */
export const SYNTRA = {
  tenantId: SYNTRA_TENANT_ID,
  id: syntraId,
  /** The person's Active account, e.g. `SYNTRA.user('E016')`. */
  user: (employeeCode: string) => syntraId('UserAccount', employeeCode),
  employee: (employeeCode: string) => syntraId('Employee', employeeCode),
  unit: (code: string) => syntraId('OrgUnit', code),
  /** One persona per role (BR-KPI-62). */
  personas: { employee: 'E016', manager: 'E006', hr: 'E035', cnb: 'E036', bod: 'E001', admin: 'E032' },
} as const;

export const DEMO = {
  tenantId: DEMO_TENANT_ID,
  id: demoId,
  user: (employeeCode: string) => demoId('UserAccount', employeeCode),
  employee: (employeeCode: string) => demoId('Employee', employeeCode),
  unit: (code: string) => demoId('OrgUnit', code),
  personas: { employee: 'D003', manager: 'D002', hr: 'D004', cnb: 'D005', bod: 'D001', admin: 'D006' },
} as const;
