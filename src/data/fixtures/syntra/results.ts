import type { CyclePeriod, Id } from '@/data/types';
import { ResultScript } from '../results';
import type { IdFn, SeedRows } from '../shared';
import { vn } from '../timeline';
import type { SyntraGoals } from './goals';

/**
 * Period results (BR-KPI-40…43), produced by `resultRules` over the finished rows — run LAST, once
 * the goals, actuals and evaluation forms are in place. Each step is what HR / C&B would have done:
 *
 * - **T01** (period locked): calculate → two adjustments (E016 −2 points for attendance; E023 +2
 *   points, which lift 88.97 C to 90.97 B and its payout 50% → 80%) → finalise every result that can
 *   be → lock ⇒ Locked. E027's plan stopped at 3 goals (75%), so it cannot be finalised: Draft.
 * - **T02** (period locked): calculate → one adjustment (E040 −2, which drops 100.30 A to 98.30 B) →
 *   finalise all but E023 (held: its manager step was taken by a delegate, HR checks it first) ⇒
 *   Final. Draft: E023 (held), E027 (75%), the company plan (one ERP Sale record never arrived —
 *   ERR-KPI-09). E025, E026, E028, E037 and E041 have no completed T02 form, so no result (ASSUMPTION Q17).
 * - **T03**: calculate only ⇒ the company and department plans are Draft (CSKH and Mua hàng are
 *   incomplete — the CRM file is still Validating); no employee has a completed T03 form yet.
 *
 * Finalised on the period's evaluation deadline at 09:00. No payroll export yet (T6).
 */
export function buildResults(s: SeedRows, id: IdFn, g: SyntraGoals): void {
  const script = new ResultScript(s, id);
  const finalisedAt = (p: CyclePeriod) => vn(`${p.evalDeadline as string} 09:00`);
  const plan = (owner: string): Id => g.plan(owner).id;

  const t01 = g.period('T01');
  script.calculate(t01.id);
  script.adjust(t01.id, plan('E016'), -2);
  script.adjust(t01.id, plan('E023'), 2);
  script.finalizeAll(t01.id, finalisedAt(t01));
  script.lock(t01.id);

  const t02 = g.period('T02');
  script.calculate(t02.id);
  script.adjust(t02.id, plan('E040'), -2);
  script.finalizeAll(t02.id, finalisedAt(t02), [plan('E023')]);

  script.calculate(g.period('T03').id);
}
