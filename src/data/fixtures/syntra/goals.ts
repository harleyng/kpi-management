import type { CyclePeriod, Goal, GoalPlan, GoalPlanStatus, Id, Kgi } from '@/data/types';
import { goalFromKpi, type IdFn, type Library, type SeedRows } from '../shared';
import { CYCLE_2026, CYCLE_2027, CYCLE_2028, T } from '../timeline';
import { DEPARTMENTS, type DepartmentCode, type SyntraOrg } from './org';

/**
 * Cycles, periods, Goal Plans, KGIs, goals, levels, cascades / links and monthly targets.
 *
 * Targets are ANNUAL on the goal: a SUM KPI's year = 12 × the DATX monthly figure, split evenly into
 * monthly `GoalPeriodTarget`s; an AVG / LAST KPI keeps the same value every month. A CASCADE is used
 * only for SUM KPIs (a share of an amount); ratio KPIs are LINKed (a share of a percentage is not an
 * allocation).
 */

type GoalSpec = readonly [kpiCode: string, weight: number, annualTarget: number | null];

/** The 9 department plans (from their DATX templates; 4-item sets get a 5th goal, BR-KPI-03). */
const DEPARTMENT_GOALS: Readonly<Record<DepartmentCode, readonly GoalSpec[]>> = {
  KDBH: [['KPI-DOANH-THU', 20, 96_000_000_000], ['KPI-LN-THUAN', 30, 21_600_000_000], ['KPI-CP-LUONG', 20, 8], ['KPI-CR', 5, 10], ['KPI-AOV', 10, 600_000], ['KPI-HOA-HONG', 5, 4], ['KPI-GIU-CHAN-NS', 10, 70]],
  MKT: [['KPI-DOANH-THU', 25, 48_000_000_000], ['KPI-LN-THUAN', 25, 12_000_000_000], ['KPI-SO-KH', 12.5, 120_000], ['KPI-SO-KH-CU', 12.5, 36_000], ['KPI-NS-XEP-HANG', 12.5, 80], ['KPI-TUYEN-DUNG', 12.5, 12]],
  CSKH: [['KPI-TL-KHIEU-NAI', 25, 2], ['KPI-TL-KH-SUCCESS', 25, 95], ['KPI-TL-KET-NOI', 25, 60], ['KPI-CP-LUONG', 10, 1.03], ['KPI-TL-HAI-LONG', 15, 90]],
  MH: [['KPI-XA-TON', 20, 2_400_000_000], ['KPI-DUT-HANG', 10, 0], ['KPI-TON-KHO', 20, 5_000_000_000], ['KPI-CP-MUA-HANG', 10, 120_000_000_000], ['KPI-LEAD-TIME', 20, 7], ['KPI-DAM-BAO-HANG', 10, 98], ['KPI-TL-KN-CLSP', 10, 1]],
  VHN: [['KPI-TL-HOAN-HUY', 25, 3], ['KPI-CP-LUONG', 25, 2.5], ['KPI-CP-DONG-GOI', 20, 15_000], ['KPI-CP-BU-SHIP', 15, 8_000], ['KPI-DAM-BAO-HANG', 15, 98]],
  CN: [['KPI-TINH-NANG', 20, 240], ['KPI-CP-LUONG', 10, 1.07], ['KPI-CP-VAN-HANH', 10, 0.68], ['KPI-NGAN-SACH-QC', 10, 28.5], ['KPI-MY-RESULT', 10, 100], ['KPI-DAU', 10, 33_000], ['KPI-LOI-LON', 15, null], ['KPI-HIEU-NANG', 15, 400]],
  HCNS: [['KPI-TUYEN-DUNG', 25, 60], ['KPI-CP-LUONG', 15, 1.2], ['KPI-CP-VAN-HANH', 10, 0.8], ['KPI-NSLD', 25, 90_000_000], ['KPI-HE-THONG', 25, 12]],
  KT: [['KPI-TSLN', 20, 10], ['KPI-DONG-TIEN', 20, 16_800_000_000], ['KPI-HTK-CONG-NO', 10, 1], ['KPI-CP-LUONG', 10, 0.9], ['KPI-CP-VAN-HANH', 10, 0.6], ['KPI-HO-SO-QT', 20, 100], ['KPI-BCTC-DUNG-HAN', 10, null]],
  KH: [['KPI-HT-KPI-BP', 20, 80], ['KPI-TSLN', 20, 15], ['KPI-SO-KH', 10, 347_484], ['KPI-TL-KH-CU', 20, 33], ['KPI-NSLD', 20, 90_000_000], ['KPI-DOANH-THU', 10, 160_800_000_000]],
};

const COMPANY_GOALS: readonly GoalSpec[] = [
  ['KPI-DOANH-THU', 20, 160_800_000_000],
  ['KPI-TSLN', 20, 15],
  ['KPI-SO-KH', 10, 347_484],
  ['KPI-TL-KH-CU', 20, 33], // ASSUMPTION Q4: higher is better
  ['KPI-NHAN-SU', 10, 130],
  ['KPI-NSLD', 20, 90_000_000],
];

const KGI_NAMES: Readonly<Record<DepartmentCode | 'SYN' | 'BL', readonly [string, string, string]>> = {
  SYN: ['Tăng trưởng doanh thu bền vững', 'Mở rộng và giữ chân khách hàng', 'Nâng cao năng suất đội ngũ'],
  KDBH: ['Tăng trưởng doanh thu kênh tư vấn', 'Nâng hiệu quả chuyển đổi', 'Xây dựng đội ngũ bán hàng ổn định'],
  MKT: ['Mở rộng tệp khách hàng', 'Tăng doanh thu từ khách hàng cũ', 'Phát triển đội ngũ marketing'],
  CSKH: ['Giảm khiếu nại của khách hàng', 'Tăng tỉ lệ khách hàng thành công', 'Kiểm soát chi phí chăm sóc khách hàng'],
  MH: ['Đảm bảo hàng hóa liên tục', 'Tối ưu tồn kho', 'Kiểm soát chi phí mua hàng'],
  VHN: ['Giảm hoàn hủy đơn hàng', 'Tối ưu chi phí giao vận', 'Đảm bảo chất lượng vận hành'],
  CN: ['Ổn định hệ thống', 'Đẩy nhanh phát triển tính năng', 'Số hóa vận hành nội bộ'],
  HCNS: ['Đủ nhân sự đúng thời điểm', 'Nâng năng suất lao động', 'Hoàn thiện cơ chế, chính sách'],
  KT: ['Đảm bảo lợi nhuận theo kế hoạch', 'Kiểm soát dòng tiền và công nợ', 'Báo cáo đúng hạn, chính xác'],
  KH: ['Hoàn thành kế hoạch kinh doanh năm', 'Giữ chân khách hàng', 'Nâng hiệu quả các bộ phận'],
  BL: ['Duy trì doanh thu bán lẻ', 'Tối ưu lãi gộp', 'Phát triển nguồn khách'],
};

/** Employee weights for a 5-goal plan; a plan cut short at step 2 keeps the first three. */
const STAFF_WEIGHTS = [30, 25, 20, 15, 10] as const;
/** A staff member's share of a department SUM target (3 people carry 90%). */
const STAFF_SHARE = 0.3;

/** Where each staff plan stands at SEED_NOW (design §5). Absent = Locked, registration Completed. */
export const STAFF_PLAN_STATE: Readonly<Record<string, { status: GoalPlanStatus; goals: number; note: string }>> = {
  E018: { status: 'Draft', goals: 0, note: 'new hire, registration launched 04-05, form at step 1' },
  E027: { status: 'Locked', goals: 3, note: 'AUTO_LOCKed 01-09 at step 2, never unlocked (frozen)' },
  E040: { status: 'Approved', goals: 5, note: 'AUTO_LOCKed 01-12 at step 4, unlocked 04-05, waiting for HR' },
  E017: { status: 'Submitted', goals: 5, note: 'AUTO_LOCKed 01-11 at step 3, unlocked 04-05, waiting for the manager — the §8.2 "TP returns" plan' },
  E021: { status: 'Returned', goals: 5, note: 'AUTO_LOCKed 01-11 at step 3, unlocked 04-05, returned to step 2 that afternoon' },
  E030: { status: 'Draft', goals: 3, note: 'AUTO_LOCKed 01-09 at step 2, unlocked 04-05, employee still adding goals' },
};

/**
 * Staff whose registration was AUTO_LOCKed, and when (the tick after their step's deadline). Their
 * plans stayed Locked until HR unlocked four of them on 04-05, so all five were evaluated T01–T03.
 */
export const AUTO_LOCK_AT: Readonly<Record<string, string>> = {
  E027: T.autoLockAtStep2,
  E030: T.autoLockAtStep2,
  E017: T.autoLockAtStep3,
  E021: T.autoLockAtStep3,
  E040: T.autoLockAtStep4,
};
export const REENTERED = ['E040', 'E017', 'E021', 'E030'] as const;

export interface SyntraGoals {
  cycleId: Id;
  periods: CyclePeriod[];
  period(label: string): CyclePeriod;
  /** Plan by owner: an employee code, a department code, `SYN` (company), `BL` (2026 historical). */
  plan(owner: string): GoalPlan;
  goalsOf(owner: string): Goal[];
  kgisOf(owner: string): Kgi[];
  /** Is this KPI summed over the year (its monthly target = annual / 12)? */
  isSum(goal: Goal): boolean;
  /** The goal's target for one month (`null` for a text goal). */
  monthlyTarget(goal: Goal): number | null;
  /** The adjustment of February: what the approved GOAL_CHANGE replaced (E026). */
  change: { modified: Goal; replacement: Goal; cancelled: Goal; added: Goal };
}

export function buildGoals(s: SeedRows, id: IdFn, org: SyntraOrg, lib: Library, ratingScaleId: Id, oldScaleId: Id): SyntraGoals {
  // ─── Cycles and periods ──────────────────────────────────────────────────────────────────────
  const cycleId = id('PerformanceCycle', '2027');
  const cycle2026 = id('PerformanceCycle', '2026');
  s.add('PerformanceCycle', { id: cycle2026, name: 'KPI 2026', startDate: CYCLE_2026.start, endDate: CYCLE_2026.end, ratingScaleId: oldScaleId, status: 'Closed' });
  s.add('PerformanceCycle', { id: cycleId, name: 'KPI 2027', startDate: CYCLE_2027.start, endDate: CYCLE_2027.end, ratingScaleId, status: 'Active' });
  s.add('PerformanceCycle', { id: id('PerformanceCycle', '2028'), name: 'KPI 2028', startDate: CYCLE_2028.start, endDate: CYCLE_2028.end, ratingScaleId, status: 'Planning' });

  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
  const periods: CyclePeriod[] = [];
  const addMonths = (year: number, cycle: Id, locked: (m: number) => boolean) => {
    for (let m = 1; m <= 12; m++) {
      const next = m === 12 ? `${year + 1}-01` : `${year}-${pad(m + 1)}`;
      const row = s.add('CyclePeriod', {
        id: id('CyclePeriod', year, `T${pad(m)}`),
        cycleId: cycle,
        periodType: 'Month',
        label: `T${pad(m)}`,
        startDate: `${year}-${pad(m)}-01`,
        endDate: `${year}-${pad(m)}-${lastDay(year, m)}`,
        inputDeadline: `${next}-05`,
        evalDeadline: `${next}-13`,
        isLocked: locked(m),
      });
      if (year === 2027) periods.push(row);
    }
  };
  addMonths(2026, cycle2026, () => true);
  addMonths(2027, cycleId, (m) => m <= 2); // T01, T02 locked for actuals
  for (let q = 1; q <= 4; q++) {
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    periods.push(
      s.add('CyclePeriod', {
        id: id('CyclePeriod', 2027, `Q${q}`),
        cycleId,
        periodType: 'Quarter',
        label: `Q${q}`,
        startDate: `2027-${pad(startMonth)}-01`,
        endDate: `2027-${pad(endMonth)}-${lastDay(2027, endMonth)}`,
        inputDeadline: null,
        evalDeadline: null,
        isLocked: false,
      }),
    );
  }

  // ─── Plans, KGIs, goals ──────────────────────────────────────────────────────────────────────
  const KPI_CODE_OF = new Map<Id, string>(s.rows.KpiDefinition.map((k) => [k.id, k.code]));
  const kpiCodeOf = (goal: Goal) => KPI_CODE_OF.get(goal.kpiDefId as Id) as string;
  const isSum = (goal: Goal) => lib.kpi(kpiCodeOf(goal)).aggregation === 'SUM';
  const plans = new Map<string, GoalPlan>();
  const goals = new Map<string, Goal[]>();
  const kgis = new Map<string, Kgi[]>();

  const addPlan = (owner: string, plan: Omit<GoalPlan, 'tenantId' | 'id' | 'planType'>, kgiNames: readonly string[]) => {
    const row = s.add('GoalPlan', { id: id('GoalPlan', plan.cycleId, owner), planType: 'KPI', ...plan });
    plans.set(owner, row);
    kgis.set(
      owner,
      kgiNames.map((name, i) =>
        s.add('Kgi', {
          id: id('Kgi', row.id, i + 1),
          goalPlanId: row.id,
          name,
          description: null,
          sortOrder: i + 1,
          // ASSUMPTION Q9: a KGI may carry a numeric target; it is never scored.
          targetValue: owner === 'SYN' && i === 0 ? 160_800_000_000 : null,
          unitId: owner === 'SYN' && i === 0 ? lib.unitId('VND') : null,
        }),
      ),
    );
    goals.set(owner, []);
    return row;
  };

  const addGoal = (owner: string, key: string, kpiCode: string, weight: number, target: number | null, extra: Partial<Parameters<typeof goalFromKpi>[5]> = {}) => {
    const plan = plans.get(owner) as GoalPlan;
    const list = goals.get(owner) as Goal[];
    const planKgis = kgis.get(owner) as Kgi[];
    const ownerEmployeeId = plan.ownerEmployeeId ?? (owner === 'SYN' ? org.employeeId('E001') : owner === 'BL' ? null : org.employeeId(org.headOf(owner as DepartmentCode).code));
    const cycle = plan.cycleId === cycle2026 ? CYCLE_2026 : CYCLE_2027;
    const row = s.add(
      'Goal',
      goalFromKpi(lib, plan, id('Goal', plan.id, key), kpiCode, list.length + 1, {
        weight,
        target,
        kgiId: planKgis[list.length % planKgis.length]?.id ?? null,
        ownerEmployeeId,
        startDate: cycle.start,
        dueDate: cycle.end,
        ...extra,
      }),
    );
    list.push(row);
    return row;
  };

  const lockedAt = (status: GoalPlanStatus, at: string) => (status === 'Locked' ? at : null);

  // The 2026 plan of the unit closed at the end of 2026 (an Inactive unit with a historical plan).
  addPlan('BL', { cycleId: cycle2026, ownerType: 'OrgUnit', ownerOrgUnitId: org.unitId('BL'), ownerEmployeeId: null, status: 'Locked', lockedAt: '2026-01-20T08:00:00.000Z' }, KGI_NAMES.BL);
  (
    [
      ['KPI-DOANH-THU', 20, 36_000_000_000],
      ['KPI-LAI-GOP', 40, 9_000_000_000],
      ['KPI-LEAD', 20, 60_000],
      ['KPI-AOV', 10, 450_000],
      ['KPI-CR', 10, 8],
    ] as const
  ).forEach(([code, w, target], i) => addGoal('BL', String(i + 1), code, w, target));

  // Company and departments: registered and locked in December 2026 (unitPlansDone).
  addPlan('SYN', { cycleId, ownerType: 'Company', ownerOrgUnitId: org.unitId('SYN'), ownerEmployeeId: null, status: 'Locked', lockedAt: T.unitPlansDone }, KGI_NAMES.SYN);
  COMPANY_GOALS.forEach(([code, w, target], i) => addGoal('SYN', String(i + 1), code, w, target));
  for (const dept of DEPARTMENTS) {
    addPlan(dept, { cycleId, ownerType: 'OrgUnit', ownerOrgUnitId: org.unitId(dept), ownerEmployeeId: null, status: 'Locked', lockedAt: T.unitPlansDone }, KGI_NAMES[dept]);
    DEPARTMENT_GOALS[dept].forEach(([code, w, target], i) =>
      addGoal(dept, String(i + 1), code, w, target, {
        // "Tự giao" — the Kinh doanh head keeps 10% of the cascaded revenue (D3).
        selfAssignedValue: dept === 'KDBH' && i === 0 ? 9_600_000_000 : null,
        targetText: code === 'KPI-LOI-LON' || code === 'KPI-BCTC-DUNG-HAN' ? 'Đạt' : null,
      }),
    );
  }


  // Staff plans: five goals drawn from the department plan (goal 1 aligned to the department's).
  for (const dept of DEPARTMENTS) {
    const deptGoals = goals.get(dept) as Goal[];
    for (const person of org.staffOf(dept)) {
      const state = STAFF_PLAN_STATE[person.code];
      const status = state?.status ?? 'Locked';
      const at = AUTO_LOCK_AT[person.code] ?? null;
      addPlan(
        person.code,
        {
          cycleId,
          ownerType: 'Employee',
          ownerOrgUnitId: null,
          ownerEmployeeId: org.employeeId(person.code),
          status,
          lockedAt: lockedAt(status, at ?? T.registrationLocked),
        },
        KGI_NAMES[dept],
      );
      const count = state?.goals ?? 5;
      for (let i = 0; i < count; i++) {
        let source = deptGoals[i];
        const extra: Partial<Parameters<typeof goalFromKpi>[5]> = {};
        // Per-person variety the tracks need: LEVELS (D1), a TEXT target, a PRIVATE goal (D2).
        if (person.code === 'E038' && i === 4) source = deptGoals.find((g) => kpiCodeOf(g) === 'KPI-HO-SO-QT') as Goal;
        if (person.code === 'E039' && i === 4) source = deptGoals.find((g) => kpiCodeOf(g) === 'KPI-BCTC-DUNG-HAN') as Goal;
        if (person.code === 'E020' && i === 3) extra.visibility = 'PRIVATE';
        if ((person.code === 'E023' && i === 0) || (person.code === 'E038' && i === 4)) extra.method = 'CM-LEVELS';
        const code = kpiCodeOf(source);
        const target = source.targetType === 'TEXT' ? null : isSum(source) ? round(Number(source.targetValue) * STAFF_SHARE) : source.targetValue;
        if (source.targetType === 'TEXT') extra.targetText = 'Đạt';
        addGoal(person.code, String(i + 1), code, STAFF_WEIGHTS[i], extra.method === 'CM-LEVELS' ? levelTarget(person.code) : target, extra);
      }
    }
  }

  // ─── The approved February adjustment on E026 (BR-KPI-15) ───────────────────────────────────
  const e026 = goals.get('E026') as Goal[];
  const modified = e026[2];
  const cancelled = e026[4];
  const replace = (goal: Goal, patch: Partial<Goal>) => {
    const list = s.rows.Goal;
    const index = list.findIndex((g) => g.id === goal.id);
    list[index] = { ...list[index], ...patch };
    return list[index];
  };
  const modifiedRow = replace(modified, { status: 'Changed' });
  const cancelledRow = replace(cancelled, { status: 'Cancelled' });
  const replacement = addGoal('E026', '3b', kpiCodeOf(modified), modified.weight, round(Number(modified.targetValue) * 0.9), {
    replacesGoalId: modified.id,
    kgiId: modified.kgiId,
  });
  const added = addGoal('E026', '6', 'KPI-TL-KN-CLSP', cancelled.weight, 1);
  e026.splice(2, 1, modifiedRow);
  e026.splice(4, 1, cancelledRow);

  // ─── Target levels (D1) ──────────────────────────────────────────────────────────────────────
  const levelsOf: Record<string, readonly [number, number][]> = {
    // Lower is better: complaint rate 5% → 0, 3% → 100, 2% → 120.
    E023: [[5, 0], [3, 100], [2, 120]],
    // Settlement files completed: 80% → 60, 95% → 100, 100% → 110.
    E038: [[80, 60], [95, 100], [100, 110]],
  };
  for (const [owner, levels] of Object.entries(levelsOf)) {
    const goal = (goals.get(owner) as Goal[]).find((g) => g.calcMethodId === lib.method('CM-LEVELS').id) as Goal;
    levels.forEach(([targetValue, scorePct], i) =>
      s.add('GoalTargetLevel', { id: id('GoalTargetLevel', goal.id, `L${i + 1}`), goalId: goal.id, levelCode: (['L1', 'L2', 'L3'] as const)[i], targetValue, targetText: null, scorePct }),
    );
  }

  // ─── Alignment: company → department → staff ────────────────────────────────────────────────
  const goalOf = (owner: string, code: string) => (goals.get(owner) as Goal[]).find((g) => kpiCodeOf(g) === code && g.status === 'Active') as Goal;
  const align = (child: Goal, parent: Goal, type: 'CASCADE' | 'LINK', value: number) =>
    s.add('GoalAlignment', {
      id: id('GoalAlignment', child.id, parent.id),
      childGoalId: child.id,
      parentGoalId: parent.id,
      alignmentType: type,
      contributionPct: type === 'LINK' ? value : null,
      allocatedValue: type === 'CASCADE' ? value : null,
    });
  // Company revenue: 96 + 48 of 160.8 bn cascaded → 16.8 bn "chưa giao" at company level (derived, never stored).
  align(goalOf('KDBH', 'KPI-DOANH-THU'), goalOf('SYN', 'KPI-DOANH-THU'), 'CASCADE', 96_000_000_000);
  align(goalOf('MKT', 'KPI-DOANH-THU'), goalOf('SYN', 'KPI-DOANH-THU'), 'CASCADE', 48_000_000_000);
  align(goalOf('MKT', 'KPI-SO-KH'), goalOf('SYN', 'KPI-SO-KH'), 'CASCADE', 120_000);
  align(goalOf('KH', 'KPI-DOANH-THU'), goalOf('SYN', 'KPI-DOANH-THU'), 'LINK', 100);
  align(goalOf('KT', 'KPI-TSLN'), goalOf('SYN', 'KPI-TSLN'), 'LINK', 100);
  align(goalOf('HCNS', 'KPI-NSLD'), goalOf('SYN', 'KPI-NSLD'), 'LINK', 100);
  align(goalOf('HCNS', 'KPI-TUYEN-DUNG'), goalOf('SYN', 'KPI-NHAN-SU'), 'LINK', 50);
  for (const dept of DEPARTMENTS) {
    const parent = (goals.get(dept) as Goal[])[0];
    for (const person of org.staffOf(dept)) {
      const child = (goals.get(person.code) as Goal[])[0];
      if (!child) continue;
      // KDBH: 3 × 28.8 bn + 9.6 bn self-assigned = 96 bn (nothing left); MKT: 3 × 14.4 of 48 bn → 4.8 bn "chưa giao".
      if (isSum(parent)) align(child, parent, 'CASCADE', Number(child.targetValue));
      else align(child, parent, 'LINK', STAFF_SHARE * 100);
    }
  }

  // ─── Monthly targets (BR-KPI-11) ─────────────────────────────────────────────────────────────
  // Split only where it carries information: a SUM goal's year is spread over its months. A ratio
  // (AVG / LAST) goal's monthly target IS its target, so no split row is stored for it.
  const months = periods.filter((p) => p.periodType === 'Month');
  const monthlyTarget = (goal: Goal) => (goal.targetValue === null ? null : isSum(goal) ? round(goal.targetValue / 12) : goal.targetValue);
  for (const goal of s.rows.Goal) {
    const plan = s.rows.GoalPlan.find((p) => p.id === goal.goalPlanId) as GoalPlan;
    const target = monthlyTarget(goal);
    if (plan.cycleId !== cycleId || target === null || !isSum(goal)) continue;
    for (const p of months) s.add('GoalPeriodTarget', { id: id('GoalPeriodTarget', goal.id, p.label), goalId: goal.id, periodId: p.id, targetValue: target });
  }

  return {
    cycleId,
    periods,
    period: (label) => periods.find((p) => p.label === label) as CyclePeriod,
    plan: (owner) => plans.get(owner) as GoalPlan,
    goalsOf: (owner) => goals.get(owner) ?? [],
    kgisOf: (owner) => kgis.get(owner) ?? [],
    isSum,
    monthlyTarget,
    change: { modified: modifiedRow, replacement, cancelled: cancelledRow, added },
  };
}

const levelTarget = (code: string) => (code === 'E023' ? 3 : 95);

/** Two decimals at most — fixture amounts stay readable. */
export const round = (value: number) => Math.round(value * 100) / 100;
