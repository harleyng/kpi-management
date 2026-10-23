import type { Tenant } from '@/data/types';
import { idsFor, seedId } from '../ids';
import { addLibrary, addNotificationTemplates, addRating, addWorkflows, addWorkScoring, SeedRows } from '../shared';
import { vn } from '../timeline';
import type { TenantSeed } from '../types';
import { buildActuals } from './actuals';
import { buildForms } from './forms';
import { buildGoals } from './goals';
import { buildOrg } from './org';
import { buildResults } from './results';
import { buildSystem } from './system';
import { buildWork } from './work';

/** Syntra — the full tenant (plan §6.4). Its story is in `src/data/fixtures/README.md`. */
export const SYNTRA_TENANT_ID = seedId('tenant', 'SYNTRA');
export const syntraId = idsFor('syntra');

export function buildSyntra(): TenantSeed {
  const tenant: Tenant = {
    id: SYNTRA_TENANT_ID,
    code: 'SYNTRA',
    name: 'Syntra',
    timezone: 'Asia/Ho_Chi_Minh',
    status: 'Active',
    createdAt: vn('2026-10-01 09:00'),
  };
  const id = syntraId;
  const s = new SeedRows(tenant.id);

  const org = buildOrg(s, id);
  const lib = addLibrary(s, id, { unitIdOf: org.unitId });
  const wf = addWorkflows(s, id);
  const rating = addRating(s, id, '2027-01-01');

  // The 2026 scale, retired with its cycle (ASSUMPTION Q2 too).
  const oldScaleId = id('RatingScale', '2026');
  s.add('RatingScale', { id: oldScaleId, name: 'Thang đánh giá 2026', status: 'Inactive' });
  s.add('RatingLevel', { id: id('RatingLevel', '2026', 'KD'), ratingScaleId: oldScaleId, code: 'KD', label: 'Không đạt', minScore: 0, maxScore: 100, sortOrder: 1 });
  s.add('RatingLevel', { id: id('RatingLevel', '2026', 'D'), ratingScaleId: oldScaleId, code: 'D', label: 'Đạt', minScore: 100, maxScore: 120, sortOrder: 2 });
  // A unit-specific payout: Kinh doanh pays 130% for A+ (invented sample, ASSUMPTION Q2).
  s.add('PayoutRule', {
    id: id('PayoutRule', 'KDBH', 'A+'),
    ratingScaleId: rating.scaleId,
    ratingLevelId: rating.level('A+').id,
    appliesTo: 'OrgUnit',
    orgUnitId: org.unitId('KDBH'),
    positionId: null,
    payoutPct: 130,
    effectiveFrom: '2027-01-01',
  });

  const goals = buildGoals(s, id, org, lib, rating.scaleId, oldScaleId);
  const actuals = buildActuals(s, id, org, lib, goals);
  const forms = buildForms(s, id, org, goals, actuals, wf);
  addWorkScoring(s, id);
  buildWork(s, id, org, goals, wf);
  const templateOf = addNotificationTemplates(s, id);
  buildSystem(s, id, org, goals, forms, templateOf);
  // Last: results are computed from everything above, through resultRules (never typed in).
  buildResults(s, id, goals);

  return { tenant, rows: s.rows };
}
