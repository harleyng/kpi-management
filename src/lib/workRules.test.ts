import { describe, expect, it } from 'vitest';
import type { WorkReview, WorkReviewItem } from '@/data/types';
import {
  columnTotals,
  linkedGoalIssues,
  planSubmitIssues,
  progressIssues,
  reviewSubmitIssues,
  taskEditBlockers,
  workResultOf,
  type TaskEditContext,
  DEFAULT_WORK_SCORING,
  effectiveWeights,
  finalWorkScore,
  hsht,
  hsnvIssues,
  hsnvRequired,
  kqcv,
  taskWeightIssues,
  totalTaskWeight,
  workScoreIssue,
  workScoringIssues,
  type TaskScore,
  type WeightedTask,
  type WorkScoring,
  copyFromPreviousMonth,
  currentMonthForm,
  displayWorkScore,
  reviewClearCopiedCells,
  reviewColumnPrefill,
  reviewColumnsShown,
  sameWorkScore,
  workFinalOverrideIssues,
  workReviewEffects,
  defaultWorkMonth,
  followProgress,
  previousMonth,
  weightedProgress,
  workPlanStatusOnEnterStep,
} from './workRules';

const task = (id: string, weight: number, cancelledAt: string | null = null): WeightedTask => ({ id, weight, cancelledAt });
const score = (taskId: string, value: number | null): TaskScore => ({ taskId, score: value });
const cfg = DEFAULT_WORK_SCORING;
const details = (issues: { code: string; detail: string | null }[]) => issues.map((i) => `${i.code}:${i.detail}`);

const plan = [task('a', 50), task('b', 30), task('c', 20)];

describe('taskWeightIssues — live weights must total 100% within ±0.01', () => {
  it.each([
    [99.99, true],
    [100, true],
    [100.01, true],
    [99.98, false],
    [101, false],
  ])('total %s → ok %s', (last, ok) => {
    const issues = taskWeightIssues([task('a', 50), task('b', 30), task('c', last - 80)]);
    expect(issues.length === 0).toBe(ok);
    if (!ok) expect(issues[0]).toMatchObject({ code: 'ERR-KPI-07', data: { totalWeight: expect.closeTo(last, 6) } });
  });

  it('a cancelled task carries no weight', () => {
    expect(totalTaskWeight([...plan, task('x', 40, '2026-10-12T00:00:00Z')])).toBe(100);
    expect(taskWeightIssues([...plan, task('x', 40, '2026-10-12T00:00:00Z')])).toEqual([]);
  });

  it('a live task weighing 0 or less is invalid, pointing at the task', () => {
    const issues = taskWeightIssues([task('a', 100), task('z', 0), task('n', -5)]);
    expect(issues.filter((i) => i.detail === 'WEIGHT_INVALID').map((i) => i.ref)).toEqual(['z', 'n']);
  });

  it('an empty plan totals 0 → ERR-KPI-07', () => {
    expect(details(taskWeightIssues([]))).toEqual(['ERR-KPI-07:null']);
  });
});

describe('effectiveWeights — cancelled tasks dropped, the rest normalised to 100 (ASSUMPTION Q64)', () => {
  it('leaves an approved plan as it is', () => {
    expect(effectiveWeights(plan)).toEqual([
      { taskId: 'a', weight: 50 },
      { taskId: 'b', weight: 30 },
      { taskId: 'c', weight: 20 },
    ]);
  });

  it('rescales after a mid-month cancel', () => {
    const weights = effectiveWeights([task('a', 50), task('b', 30, '2026-10-15T00:00:00Z'), task('c', 20)]);
    expect(weights.map((w) => w.taskId)).toEqual(['a', 'c']);
    expect(weights[0].weight).toBeCloseTo(71.428571, 5);
    expect(weights[1].weight).toBeCloseTo(28.571429, 5);
  });

  it('every task cancelled → nothing to score', () => {
    expect(effectiveWeights([task('a', 60, 't'), task('b', 40, 't')])).toEqual([]);
  });

  it('a negative live weight → nothing to score (never a weight that flips a score)', () => {
    expect(effectiveWeights([task('a', 120), task('b', -20)])).toEqual([]);
  });
});

describe('kqcv — Σ score × weight / 100', () => {
  it('50/30/20 scored 100/80/0 → 74', () => {
    expect(kqcv(plan, [score('a', 100), score('b', 80), score('c', 0)])).toBe(74);
  });

  it('a 0 score is a score; a missing one makes KQcv null, never 0', () => {
    expect(kqcv(plan, [score('a', 100), score('b', 80)])).toBeNull();
    expect(kqcv(plan, [score('a', 100), score('b', 80), score('c', null)])).toBeNull();
    expect(kqcv(plan, [score('a', 100), score('b', 80), score('c', Number.NaN)])).toBeNull();
  });

  it('a cancelled task is left out and the rest are normalised', () => {
    const tasks = [task('a', 50), task('b', 30, '2026-10-15T00:00:00Z'), task('c', 20)];
    // 100 × 50/70 + 50 × 20/70 = 85.714…
    expect(kqcv(tasks, [score('a', 100), score('c', 50)])).toBeCloseTo(85.714286, 5);
    // a score left on the cancelled task changes nothing
    expect(kqcv(tasks, [score('a', 100), score('b', 0), score('c', 50)])).toBeCloseTo(85.714286, 5);
  });

  it('every task cancelled → null', () => {
    expect(kqcv([task('a', 100, 't')], [score('a', 90)])).toBeNull();
  });

  it('a score for an unknown task is ignored', () => {
    expect(kqcv(plan, [score('a', 100), score('b', 100), score('c', 100), score('ghost', 0)])).toBe(100);
  });

  it('a link to a KPI does not touch the score (Q63)', () => {
    const linked = plan.map((t, i) => ({ ...t, linkedGoalId: i === 0 ? 'goal-1' : null }));
    const scores = [score('a', 100), score('b', 80), score('c', 0)];
    expect(kqcv(linked, scores)).toBe(kqcv(plan, scores));
  });
});

describe('hsht — 70% × KQcv + 30% × KLcv', () => {
  it('combines the two parts', () => {
    expect(hsht(74, 90, cfg)).toBeCloseTo(78.8, 9);
    expect(hsht(100, 100, cfg)).toBe(100);
    expect(hsht(0, 0, cfg)).toBe(0);
  });

  it('either side missing → null', () => {
    expect(hsht(null, 90, cfg)).toBeNull();
    expect(hsht(74, null, cfg)).toBeNull();
    expect(hsht(Number.NaN, 90, cfg)).toBeNull();
  });

  it('follows the tenant’s weights (60/40)', () => {
    expect(hsht(80, 50, { ...cfg, resultWeight: 60, disciplineWeight: 40 })).toBe(68);
  });

  it('a 0 / 100 split is discipline only', () => {
    expect(hsht(10, 90, { ...cfg, resultWeight: 0, disciplineWeight: 100 })).toBe(90);
  });
});

describe('hsnvRequired — strictly below the threshold', () => {
  it.each([
    [79.99, true],
    [79.999999, true],
    [80, false],
    [80.01, false],
    [0, true],
  ])('Hsht %s → %s', (value, required) => {
    expect(hsnvRequired(value, cfg)).toBe(required);
  });

  it('70% × 80 + 30% × 80 counts as exactly 80', () => {
    expect(hsnvRequired(hsht(80, 80, cfg), cfg)).toBe(false);
  });

  it('no Hsht yet → not required', () => {
    expect(hsnvRequired(null, cfg)).toBe(false);
  });

  it('a threshold at the bottom of the scale never requires Hsnv', () => {
    expect(hsnvRequired(0, { ...cfg, hsnvThreshold: 0 })).toBe(false);
  });

  it('follows the tenant’s threshold', () => {
    expect(hsnvRequired(75, { ...cfg, hsnvThreshold: 70 })).toBe(false);
  });
});

describe('hsnvIssues — Hsnv and its reason when required', () => {
  it('not required → nothing checked', () => {
    expect(hsnvIssues(85, null, null, cfg)).toEqual([]);
  });

  it('required: Hsnv and reason both missing', () => {
    expect(hsnvIssues(70, null, '  ', cfg).map((i) => [i.ref, i.detail])).toEqual([
      ['hsnv', 'HSNV_REQUIRED'],
      ['hsnvReason', 'HSNV_REASON_REQUIRED'],
    ]);
  });

  it('required: Hsnv without a reason', () => {
    expect(details(hsnvIssues(70, 75, null, cfg))).toEqual(['ERR-KPI-06:HSNV_REASON_REQUIRED']);
  });

  it('required: Hsnv off the scale', () => {
    expect(details(hsnvIssues(70, 101, 'Dự án trễ do khách hàng', cfg))).toEqual(['ERR-KPI-06:SCORE_OUT_OF_RANGE']);
  });

  it('required and complete → no issue', () => {
    expect(hsnvIssues(70, 78, 'Dự án trễ do khách hàng', cfg)).toEqual([]);
  });
});

describe('finalWorkScore — Hsnv when required, else Hsht', () => {
  it('Hsht ≥ threshold → Hsht, a stale Hsnv ignored', () => {
    expect(finalWorkScore(85, null, cfg)).toBe(85);
    expect(finalWorkScore(85, 60, cfg)).toBe(85);
  });

  it('Hsht < threshold → Hsnv', () => {
    expect(finalWorkScore(70, 78, cfg)).toBe(78);
  });

  it('required Hsnv not yet set → null; no Hsht → null', () => {
    expect(finalWorkScore(70, null, cfg)).toBeNull();
    expect(finalWorkScore(null, 90, cfg)).toBeNull();
  });
});

describe('workScoreIssue — the scale', () => {
  it.each([
    [null, null],
    [0, null],
    [100, null],
    [55.5, null],
    [-1, 'SCORE_OUT_OF_RANGE'],
    [101, 'SCORE_OUT_OF_RANGE'],
    [Number.POSITIVE_INFINITY, 'SCORE_OUT_OF_RANGE'],
  ])('%s → %s', (value, detail) => {
    expect(workScoreIssue(value, cfg, 'task-1')?.detail ?? null).toBe(detail);
  });

  it('carries the bounds for the screen', () => {
    expect(workScoreIssue(-1, cfg, 'task-1')).toMatchObject({ code: 'ERR-KPI-06', ref: 'task-1', data: { min: 0, max: 100 } });
  });
});

describe('workScoringIssues — the tenant’s settings', () => {
  const issuesOf = (patch: Partial<WorkScoring>) => details(workScoringIssues({ ...cfg, ...patch }));

  it('accepts the default and 60/40', () => {
    expect(workScoringIssues(cfg)).toEqual([]);
    expect(issuesOf({ resultWeight: 60, disciplineWeight: 40 })).toEqual([]);
  });

  it('the two weights must total 100', () => {
    expect(issuesOf({ resultWeight: 70, disciplineWeight: 20 })).toEqual(['ERR-KPI-07:null']);
  });

  it('a negative weight is invalid', () => {
    expect(issuesOf({ resultWeight: 130, disciplineWeight: -30 })).toEqual(['ERR-KPI-06:WEIGHT_INVALID']);
  });

  it('the threshold must sit on the scale, and the scale must be a range', () => {
    expect(issuesOf({ hsnvThreshold: 120 })).toEqual(['ERR-KPI-06:THRESHOLD_OUT_OF_RANGE']);
    expect(issuesOf({ scoreMin: 100, scoreMax: 100 })).toEqual(['ERR-KPI-06:SCALE_INVALID']);
  });
});

// ─── Step 8.1: plan submit, task edits, review submit, the result snapshot ────────────────────

const MARCH = { startDate: '2027-03-01', endDate: '2027-03-31' };
const planned = (id: string, weight: number, o: Partial<{ name: string; startDate: string; dueDate: string; cancelledAt: string | null }> = {}) => ({
  id, weight, cancelledAt: null, name: `Việc ${id}`, startDate: '2027-03-01', dueDate: '2027-03-31', ...o,
});

describe('planSubmitIssues — what blocks sending the month\'s plan', () => {
  it('a complete plan passes', () => {
    expect(planSubmitIssues([planned('a', 60), planned('b', 40)], MARCH)).toEqual([]);
  });

  it('no live task → PLAN_EMPTY (all cancelled counts as empty)', () => {
    expect(details(planSubmitIssues([], MARCH))).toEqual(['ERR-KPI-06:PLAN_EMPTY']);
    expect(details(planSubmitIssues([planned('a', 100, { cancelledAt: '2027-03-10T00:00:00Z' })], MARCH))).toEqual(['ERR-KPI-06:PLAN_EMPTY']);
  });

  it('a blank name, reversed dates, a task wholly outside the month, and the weights', () => {
    const issues = planSubmitIssues(
      [planned('a', 50, { name: '  ' }), planned('b', 20, { startDate: '2027-03-20', dueDate: '2027-03-10' }), planned('c', 20, { startDate: '2027-04-01', dueDate: '2027-04-10' })],
      MARCH,
    );
    expect(issues.map((i) => `${i.ref}:${i.detail ?? i.code}`)).toEqual(['a:NAME_REQUIRED', 'b:DATES_ORDER', 'c:DATES_OUTSIDE_PERIOD', 'null:ERR-KPI-07']);
  });

  it('a task carried over from last month (overlapping the month) is fine (ASSUMPTION Q68)', () => {
    expect(planSubmitIssues([planned('a', 100, { startDate: '2027-02-15', dueDate: '2027-03-10' })], MARCH)).toEqual([]);
  });
});

const ctx = (o: Partial<TaskEditContext> = {}): TaskEditContext => ({
  planStatus: 'Draft', editAtStep: null, isSubject: true, isManager: false, mayActForManager: false, reviewLaunched: false, resultRecorded: false, ...o,
});
type TaskRef = { id: string; cancelledAt: string | null };
const live: TaskRef = { id: 't1', cancelledAt: null };
const gone: TaskRef = { id: 't1', cancelledAt: '2027-03-10T00:00:00Z' };
const blockers = (c: TaskEditContext, edit: Parameters<typeof taskEditBlockers>[1], t: TaskRef | null = live, reason: string | null = null) =>
  details(taskEditBlockers(c, edit, t, reason));

describe('taskEditBlockers — who may change a task, when (plan §6)', () => {
  it('before approval: the list is edited at the step that allows EDIT; nothing to cancel or track yet', () => {
    for (const edit of ['ADD', 'UPDATE', 'REMOVE'] as const) expect(blockers(ctx(), edit)).toEqual([]);
    const notYours = ctx({ editAtStep: { code: 'ERR-KPI-05', ref: null, detail: 'NOT_ENTITLED', data: null } });
    expect(blockers(notYours, 'ADD', null)).toEqual(['ERR-KPI-05:NOT_ENTITLED']);
    expect(blockers(ctx({ isManager: true }), 'CANCEL', live, 'Lý do')).toEqual(['ERR-KPI-04:NOT_APPROVED']);
    expect(blockers(ctx(), 'PROGRESS')).toEqual(['ERR-KPI-04:NOT_APPROVED']);
  });

  it('after approval: the list is fixed — no ADD, UPDATE or REMOVE, even for the manager', () => {
    for (const edit of ['ADD', 'UPDATE', 'REMOVE'] as const) {
      expect(blockers(ctx({ planStatus: 'Locked', isManager: true, isSubject: false }), edit)).toEqual(['ERR-KPI-04:WORK_PLAN_LOCKED']);
    }
  });

  it('after approval: only the manager cancels, and only with a reason (Q64)', () => {
    const locked = ctx({ planStatus: 'Locked' });
    expect(blockers(locked, 'CANCEL', live, 'Lý do')).toEqual(['ERR-KPI-05:MANAGER_ONLY']);
    const manager = ctx({ planStatus: 'Locked', isSubject: false, isManager: true });
    expect(blockers(manager, 'CANCEL', live, '   ')).toEqual(['ERR-KPI-06:CANCEL_REASON_REQUIRED']);
    expect(blockers(manager, 'CANCEL', live, 'Khách hàng dừng dự án')).toEqual([]);
    expect(blockers(manager, 'CANCEL', gone, 'Lý do')).toEqual(['ERR-KPI-04:TASK_CANCELLED']);
  });

  it("a delegate of the manager, or HR as proxy, acts for the manager: cancels and tracks (BR-KPI-21)", () => {
    const forManager = ctx({ planStatus: 'Locked', isSubject: false, mayActForManager: true });
    expect(blockers(forManager, 'CANCEL', live, 'Lý do')).toEqual([]);
    expect(blockers(forManager, 'PROGRESS')).toEqual([]);
  });

  it('the last live task cannot be cancelled — the month would have nothing to score', () => {
    const manager = ctx({ planStatus: 'Locked', isSubject: false, isManager: true, liveTaskCount: 1 });
    expect(blockers(manager, 'CANCEL', live, 'Lý do')).toEqual(['ERR-KPI-04:LAST_LIVE_TASK']);
    expect(blockers({ ...manager, liveTaskCount: 2 }, 'CANCEL', live, 'Lý do')).toEqual([]);
  });

  it('a cancelled task is never removed, even before a review exists', () => {
    expect(blockers(ctx({ planStatus: 'Locked', isManager: true }), 'REMOVE', gone)).toEqual(['ERR-KPI-04:TASK_CANCELLED']);
  });

  it('after approval: the employee or the manager updates progress — nobody else, never on a cancelled task', () => {
    expect(blockers(ctx({ planStatus: 'Locked' }), 'PROGRESS')).toEqual([]);
    expect(blockers(ctx({ planStatus: 'Locked', isSubject: false, isManager: true }), 'PROGRESS')).toEqual([]);
    expect(blockers(ctx({ planStatus: 'Locked', isSubject: false }), 'PROGRESS')).toEqual(['ERR-KPI-05:NOT_SUBJECT_OR_MANAGER']);
    expect(blockers(ctx({ planStatus: 'Locked' }), 'PROGRESS', gone)).toEqual(['ERR-KPI-04:TASK_CANCELLED']);
  });

  it('once the review exists the list is frozen (its items were taken); progress still moves', () => {
    const reviewed = ctx({ planStatus: 'Locked', isManager: true, reviewLaunched: true });
    expect(blockers(reviewed, 'CANCEL', live, 'Lý do')).toEqual(['ERR-KPI-04:REVIEW_LAUNCHED']);
    expect(blockers(ctx({ reviewLaunched: true }), 'ADD', null)).toEqual(['ERR-KPI-04:REVIEW_LAUNCHED']);
    expect(blockers(reviewed, 'PROGRESS')).toEqual([]);
  });

  it('once the result is recorded nothing changes', () => {
    for (const edit of ['ADD', 'UPDATE', 'REMOVE', 'CANCEL', 'PROGRESS'] as const) {
      expect(blockers(ctx({ planStatus: 'Locked', isManager: true, resultRecorded: true }), edit, live, 'Lý do')).toEqual(['ERR-KPI-04:RESULT_RECORDED']);
    }
  });
});

describe('progressIssues and linkedGoalIssues', () => {
  it('progress is 0–100 and never sets Cancelled', () => {
    expect(progressIssues(0, 'NotStarted')).toEqual([]);
    expect(progressIssues(100, 'Done')).toEqual([]);
    expect(details(progressIssues(101, 'InProgress'))).toEqual(['ERR-KPI-06:PROGRESS_OUT_OF_RANGE']);
    expect(details(progressIssues(-1, 'InProgress'))).toEqual(['ERR-KPI-06:PROGRESS_OUT_OF_RANGE']);
    expect(details(progressIssues(50, 'Cancelled'))).toEqual(['ERR-KPI-06:CANCEL_BY_PROGRESS']);
  });

  it('the status agrees with the %: Done is 100, NotStarted is 0, InProgress anywhere', () => {
    expect(details(progressIssues(30, 'Done'))).toEqual(['ERR-KPI-06:STATUS_MISMATCH']);
    expect(details(progressIssues(80, 'NotStarted'))).toEqual(['ERR-KPI-06:STATUS_MISMATCH']);
    expect(progressIssues(0, 'InProgress')).toEqual([]);
    expect(progressIssues(100, 'InProgress')).toEqual([]);
  });

  it('a KPI link: an Active goal of the employee\'s own Locked plan in the month\'s cycle (Q63)', () => {
    const goal = { id: 'g1', status: 'Active' as const };
    const plan = { ownerType: 'Employee' as const, ownerEmployeeId: 'e1', status: 'Locked' as const, cycleId: 'c2027' };
    const month = { cycleId: 'c2027' };
    expect(linkedGoalIssues(null, null, 'e1', month)).toEqual([]);
    expect(linkedGoalIssues(goal, plan, 'e1', month)).toEqual([]);
    for (const [g, p, e, m] of [
      [{ ...goal, status: 'Cancelled' as const }, plan, 'e1', month],
      [goal, { ...plan, ownerEmployeeId: 'e2' }, 'e1', month],
      [goal, { ...plan, status: 'Draft' as const }, 'e1', month],
      [goal, { ...plan, ownerType: 'OrgUnit' as const }, 'e1', month],
      [goal, plan, 'e1', { cycleId: 'c2028' }],
    ] as const) {
      expect(details(linkedGoalIssues(g, p, e, m))).toEqual(['ERR-KPI-06:LINKED_GOAL_INVALID']);
    }
  });
});

const reviewRow = (o: Partial<WorkReview> = {}): WorkReview => ({
  id: 'r1', tenantId: 't', formId: 'f1', workPlanId: 'p1',
  selfDisciplineScore: null, selfComment: null,
  managerDisciplineScore: null, managerComment: null, managerHsnv: null, managerHsnvReason: null,
  finalDisciplineScore: null, finalComment: null, finalHsnv: null, finalHsnvReason: null, ...o,
});
const item = (taskId: string, o: Partial<WorkReviewItem> = {}): WorkReviewItem => ({
  id: `i-${taskId}`, tenantId: 't', formId: 'f1', taskId, selfScore: null, selfComment: null, managerScore: null, managerComment: null, finalScore: null, finalComment: null, ...o,
});
/** Tasks 50 / 30 / 20 (plus a PRIVATE one cancelled mid-month — visibility never matters). */
const tasks = [task('a', 50), task('b', 30), task('c', 20)];

describe('reviewSubmitIssues — what blocks sending a review column', () => {
  const scored = (col: 'managerScore' | 'selfScore' | 'finalScore', values: [number | null, number | null, number | null]) =>
    ['a', 'b', 'c'].map((t, i) => item(t, { [col]: values[i] }));

  it('every live task scored and KLcv set → ok; a score of 0 is a score', () => {
    expect(reviewSubmitIssues('SELF', reviewRow({ selfDisciplineScore: 0 }), scored('selfScore', [100, 0, 50]), tasks, cfg)).toEqual([]);
  });

  it('a missing score, a missing item and a missing KLcv each block', () => {
    const items = scored('selfScore', [100, null, 50]).filter((i) => i.taskId !== 'c');
    expect(reviewSubmitIssues('SELF', reviewRow(), items, tasks, cfg).map((i) => `${i.ref}:${i.detail}`)).toEqual([
      'b:TASK_SCORE_REQUIRED',
      'c:TASK_SCORE_REQUIRED',
      'selfDisciplineScore:DISCIPLINE_REQUIRED',
    ]);
  });

  it('a score off the scale blocks; a cancelled task\'s item is kept and ignored', () => {
    const withCancelled = [...tasks, task('x', 25, '2027-03-10T00:00:00Z')];
    const items = [...scored('selfScore', [101, 80, 80]), item('x', { selfScore: null })];
    expect(details(reviewSubmitIssues('SELF', reviewRow({ selfDisciplineScore: 80 }), items, withCancelled, cfg))).toEqual(['ERR-KPI-06:SCORE_OUT_OF_RANGE']);
  });

  it('all tasks cancelled → PLAN_EMPTY, and KQcv is null', () => {
    const allGone = [task('a', 100, '2027-03-10T00:00:00Z')];
    expect(details(reviewSubmitIssues('MANAGER', reviewRow(), [], allGone, cfg))).toEqual(['ERR-KPI-06:PLAN_EMPTY']);
    expect(columnTotals('MANAGER', reviewRow({ managerDisciplineScore: 90 }), [], allGone, cfg).kqcv).toBeNull();
  });

  it('MANAGER: Hsht exactly 80 needs no Hsnv; 79.99 needs Hsnv and a reason', () => {
    // KQcv 80, KLcv 80 → Hsht 80.
    expect(reviewSubmitIssues('MANAGER', reviewRow({ managerDisciplineScore: 80 }), scored('managerScore', [80, 80, 80]), tasks, cfg)).toEqual([]);
    // KQcv 80, KLcv 79.9666… → Hsht 79.99.
    const low = reviewRow({ managerDisciplineScore: 79.96666666666667 });
    expect(reviewSubmitIssues('MANAGER', low, scored('managerScore', [80, 80, 80]), tasks, cfg).map((i) => `${i.ref}:${i.detail}`)).toEqual([
      'managerHsnv:HSNV_REQUIRED',
      'managerHsnvReason:HSNV_REASON_REQUIRED',
    ]);
    expect(reviewSubmitIssues('MANAGER', { ...low, managerHsnv: 85, managerHsnvReason: 'Hỗ trợ dự án gấp' }, scored('managerScore', [80, 80, 80]), tasks, cfg)).toEqual([]);
  });

  it('SELF never asks for Hsnv, however low', () => {
    expect(reviewSubmitIssues('SELF', reviewRow({ selfDisciplineScore: 10 }), scored('selfScore', [10, 10, 10]), tasks, cfg)).toEqual([]);
  });
});

describe('workResultOf — the month\'s snapshot from the FINAL column', () => {
  const final = (values: [number, number, number], klcv: number, o: Partial<WorkReview> = {}) => ({
    review: reviewRow({ finalDisciplineScore: klcv, ...o }),
    items: ['a', 'b', 'c'].map((t, i) => item(t, { finalScore: values[i] })),
  });

  it('3 tasks 50/30/20 scored 100/80/0, KLcv 90 → KQcv 74, Hsht 78.8 → Hsnv required', () => {
    const { review, items } = final([100, 80, 0], 90, { finalHsnv: 82, finalHsnvReason: 'Việc c bị hoãn do khách hàng' });
    const r = workResultOf(review, items, tasks, cfg);
    expect(r.kqcv).toBeCloseTo(74, 9);
    expect(r.hsht).toBeCloseTo(78.8, 9);
    expect(r).toMatchObject({ klcv: 90, hsnv: 82, hsnvReason: 'Việc c bị hoãn do khách hàng', finalScore: 82 });
  });

  it('Hsnv may be above Hsht — the manager\'s decision (Q61)', () => {
    const { review, items } = final([60, 60, 60], 60, { finalHsnv: 95, finalHsnvReason: 'Lý do' });
    expect(workResultOf(review, items, tasks, cfg).finalScore).toBe(95);
  });

  it('a required Hsnv still missing → finalScore null (not recordable)', () => {
    const { review, items } = final([60, 60, 60], 60);
    expect(workResultOf(review, items, tasks, cfg)).toMatchObject({ hsnv: null, finalScore: null });
  });

  it('a draft Hsnv left after a rescoring lifted Hsht is not part of the result', () => {
    const { review, items } = final([90, 90, 90], 90, { finalHsnv: 70, finalHsnvReason: 'Cũ' });
    expect(workResultOf(review, items, tasks, cfg)).toMatchObject({ hsht: 90, hsnv: null, hsnvReason: null, finalScore: 90 });
  });

  it('a 60 / 40 tenant weighs KQcv and KLcv its way (Q62)', () => {
    const { review, items } = final([100, 100, 100], 50);
    expect(workResultOf(review, items, tasks, { ...cfg, resultWeight: 60, disciplineWeight: 40 }).hsht).toBeCloseTo(80, 9);
  });
});

// ─── Step 8.2 ──────────────────────────────────────────────────────────────────────────────────

describe('workPlanStatusOnEnterStep — the plan follows its form; approval is the lock', () => {
  const s = (stepNo: number, actorRule: 'SELF' | 'DIRECT_MANAGER' | 'HR') => ({ stepNo, actorRule });
  it('bottom-up (employee → manager): Draft, Submitted; Returned back at step 1', () => {
    const steps = [s(1, 'SELF'), s(2, 'DIRECT_MANAGER')];
    expect([1, 2].map((n) => workPlanStatusOnEnterStep(n, steps, false))).toEqual(['Draft', 'Submitted']);
    expect(workPlanStatusOnEnterStep(1, steps, true)).toBe('Returned');
  });
  it('top-down (manager → employee → manager): Draft, Draft, Submitted', () => {
    const steps = [s(1, 'DIRECT_MANAGER'), s(2, 'SELF'), s(3, 'DIRECT_MANAGER')];
    expect([1, 2, 3].map((n) => workPlanStatusOnEnterStep(n, steps, false))).toEqual(['Draft', 'Draft', 'Submitted']);
  });
  it('never Approved — a longer route stays Submitted until its last step completes', () => {
    const steps = [s(1, 'SELF'), s(2, 'DIRECT_MANAGER'), s(3, 'HR')];
    expect(workPlanStatusOnEnterStep(3, steps, false)).toBe('Submitted');
  });
});

describe('copyFromPreviousMonth — "Sao chép tháng trước"', () => {
  const april = { startDate: '2027-04-01', endDate: '2027-04-30' };
  const prev = (name: string, o: Partial<Parameters<typeof copyFromPreviousMonth>[0][number]> = {}) => ({
    name, product: null, description: 'mô tả', unitText: 'cái', weight: 25, visibility: 'PUBLIC' as const, linkedGoalId: 'g1', progressStatus: 'InProgress' as const, cancelledAt: null, ...o,
  });
  it('copies the open tasks with the new month\'s dates; skips Done and cancelled', () => {
    const r = copyFromPreviousMonth([prev('A'), prev('B', { progressStatus: 'Done' }), prev('C', { cancelledAt: '2027-03-10T00:00:00Z' }), prev('D', { visibility: 'PRIVATE' })], [], april, true);
    expect(r.tasks.map((t) => [t.name, t.startDate, t.dueDate, t.visibility, t.weight])).toEqual([
      ['A', '2027-04-01', '2027-04-30', 'PUBLIC', 25],
      ['D', '2027-04-01', '2027-04-30', 'PRIVATE', 25],
    ]);
    expect(r.skipped).toBe(0);
  });
  it('skips a task already in the list (same name and product, any case) — a second click adds nothing', () => {
    const r = copyFromPreviousMonth([prev('Báo cáo tuần'), prev('Gọi khách', { product: 'CRM' })], [{ name: ' báo cáo TUẦN', product: null }, { name: 'Gọi khách', product: 'Khác' }], april, true);
    expect(r.tasks.map((t) => t.name)).toEqual(['Gọi khách']);
    expect(r.skipped).toBe(1);
  });
  it('a task listed twice last month is copied once; a blank product matches no product; the total may pass 100', () => {
    const r = copyFromPreviousMonth([prev('A', { weight: 70 }), prev('A', { weight: 70 }), prev('B', { product: '', weight: 70 })], [{ name: 'B', product: null }], april, true);
    expect(r.tasks.map((t) => [t.name, t.weight])).toEqual([['A', 70]]);
    expect(r.skipped).toBe(2);
  });

  it('keeps a KPI link only inside the same cycle', () => {
    expect(copyFromPreviousMonth([prev('A')], [], april, true).tasks[0].linkedGoalId).toBe('g1');
    expect(copyFromPreviousMonth([prev('A')], [], april, false).tasks[0].linkedGoalId).toBeNull();
  });
});

describe('previousMonth / defaultWorkMonth', () => {
  const m = (id: string, startDate: string, endDate: string) => ({ id, periodType: 'Month' as const, startDate, endDate });
  const periods = [m('2027-01', '2027-01-01', '2027-01-31'), m('2026-12', '2026-12-01', '2026-12-31'), { ...m('Q1', '2027-01-01', '2027-03-31'), periodType: 'Quarter' as const }, m('2027-02', '2027-02-01', '2027-02-28')];
  it('the month before, across cycles; none before the first', () => {
    expect(previousMonth(periods, { startDate: '2027-01-01' })?.id).toBe('2026-12');
    expect(previousMonth(periods, { startDate: '2026-12-01' })).toBeNull();
  });
  it('opens on the month of today, else the last started, else the first', () => {
    expect(defaultWorkMonth(periods, '2027-01-15')?.id).toBe('2027-01');
    expect(defaultWorkMonth(periods, '2027-06-01')?.id).toBe('2027-02');
    expect(defaultWorkMonth(periods, '2020-01-01')?.id).toBe('2026-12');
    expect(defaultWorkMonth([], '2027-01-01')).toBeNull();
  });
});

describe('weightedProgress — tracking, never a score', () => {
  const t = (id: string, weight: number, progressPct: number, cancelledAt: string | null = null) => ({ id, weight, progressPct, cancelledAt });
  it('Σ % × weight; a cancelled task drops out and the rest are normalised', () => {
    expect(weightedProgress([t('a', 50, 100), t('b', 50, 0)])).toBe(50);
    expect(weightedProgress([t('a', 50, 100), t('b', 25, 0), t('c', 25, 40, '2027-03-10T00:00:00Z')])).toBeCloseTo(66.667, 3);
  });
  it('no live task, or weights that cannot be shares (NaN, negative, all zero) → null, never 0', () => {
    expect(weightedProgress([])).toBeNull();
    expect(weightedProgress([t('a', Number.NaN, 50)])).toBeNull();
    expect(weightedProgress([t('a', -10, 50), t('b', 110, 50)])).toBeNull();
    expect(weightedProgress([t('a', 0, 50), t('b', 0, 50)])).toBeNull();
    expect(weightedProgress([t('a', 100, 50, '2027-03-10T00:00:00Z')])).toBeNull();
  });
});

describe('followProgress — % and status kept consistent (progressIssues)', () => {
  it('picking a status sets its %', () => {
    expect(followProgress({ progressPct: 40, progressStatus: 'InProgress' }, { progressStatus: 'Done' })).toEqual({ progressPct: 100, progressStatus: 'Done' });
    expect(followProgress({ progressPct: 40, progressStatus: 'InProgress' }, { progressStatus: 'NotStarted' })).toEqual({ progressPct: 0, progressStatus: 'NotStarted' });
    expect(followProgress({ progressPct: 40, progressStatus: 'Done' }, { progressStatus: 'InProgress' })).toEqual({ progressPct: 40, progressStatus: 'InProgress' });
  });
  it('typing a % moves Done / NotStarted to InProgress when it no longer fits', () => {
    expect(followProgress({ progressPct: 100, progressStatus: 'Done' }, { progressPct: 80 })).toEqual({ progressPct: 80, progressStatus: 'InProgress' });
    expect(followProgress({ progressPct: 0, progressStatus: 'NotStarted' }, { progressPct: 10 })).toEqual({ progressPct: 10, progressStatus: 'InProgress' });
    expect(followProgress({ progressPct: 50, progressStatus: 'InProgress' }, { progressPct: 100 })).toEqual({ progressPct: 100, progressStatus: 'InProgress' });
  });
});

describe('currentMonthForm', () => {
  it('the latest form not cancelled, else the latest one, else none', () => {
    const f = (id: string, status: string, launchedAt: string) => ({ id, status, launchedAt });
    expect(currentMonthForm([f('a', 'Cancelled', '2027-04-05'), f('b', 'Completed', '2027-04-01')])?.id).toBe('b');
    expect(currentMonthForm([f('a', 'Cancelled', '2027-04-01'), f('c', 'Cancelled', '2027-04-05')])?.id).toBe('c');
    expect(currentMonthForm([])).toBeNull();
  });
});

// ─── Step 8.3 ──────────────────────────────────────────────────────────────────────────────────

describe('reviewColumnPrefill — the column a step starts from', () => {
  const rows = () => ({
    review: reviewRow({ selfDisciplineScore: 90, selfComment: 'tự nhận xét', managerDisciplineScore: null }),
    items: [item('a', { selfScore: 100, managerScore: 0 }), item('b', { selfScore: 80, selfComment: 'x' }), item('c', { selfScore: null })],
  });
  it('MANAGER: empty cells take the employee\'s scores and KLcv; a manager 0 stays; comments and Hsnv are not copied', () => {
    const before = rows();
    const { review, items } = reviewColumnPrefill(before, 'MANAGER');
    expect(items.map((i) => i.managerScore)).toEqual([0, 80, null]);
    expect(items.map((i) => i.managerComment)).toEqual([null, null, null]);
    expect(review).toMatchObject({ managerDisciplineScore: 90, managerComment: null, managerHsnv: null });
    expect(before.items[1].managerScore).toBeNull(); // pure
  });
  it('FINAL: overwritten from MANAGER — scores, KLcv, Hsnv and reason — its own comments cleared', () => {
    const { review, items } = reviewColumnPrefill(
      {
        review: reviewRow({ managerDisciplineScore: 70, managerHsnv: 72, managerHsnvReason: 'Lý do', finalDisciplineScore: 99, finalComment: 'cũ', finalHsnv: 50 }),
        items: [item('a', { managerScore: 60, finalScore: 90, finalComment: 'cũ' })],
      },
      'FINAL',
    );
    expect(review).toMatchObject({ finalDisciplineScore: 70, finalHsnv: 72, finalHsnvReason: 'Lý do', finalComment: null });
    expect(items[0]).toMatchObject({ finalScore: 60, finalComment: null });
  });
  it('SELF is never prefilled', () => {
    const r = rows();
    expect(reviewColumnPrefill(r, 'SELF')).toEqual(r);
  });
});

describe('reviewClearCopiedCells — a RETURN to the employee', () => {
  it('clears the manager cells still equal to the employee\'s; a changed one stays', () => {
    const { review, items } = reviewClearCopiedCells({
      review: reviewRow({ selfDisciplineScore: 90, managerDisciplineScore: 90 }),
      items: [item('a', { selfScore: 100, managerScore: 100 }), item('b', { selfScore: 80, managerScore: 70 }), item('c', { selfScore: 0, managerScore: 0 })],
    });
    expect(review.managerDisciplineScore).toBeNull();
    expect(items.map((i) => i.managerScore)).toEqual([null, 70, null]);
  });
});

describe('workReviewEffects', () => {
  it('by the column entered: MANAGER / FINAL prefill, a return to SELF clears copies, a completion records', () => {
    expect(workReviewEffects('MANAGER', false, false)).toEqual({ prefill: 'MANAGER', clearCopies: false, recordResult: false });
    expect(workReviewEffects('FINAL', false, false)).toEqual({ prefill: 'FINAL', clearCopies: false, recordResult: false });
    expect(workReviewEffects('SELF', true, false)).toEqual({ prefill: null, clearCopies: true, recordResult: false });
    expect(workReviewEffects('MANAGER', true, false).prefill).toBe('MANAGER'); // back from HR: FINAL waits for its next entry
    expect(workReviewEffects(null, false, true)).toEqual({ prefill: null, clearCopies: false, recordResult: true });
    expect(workReviewEffects(null, false, false)).toEqual({ prefill: null, clearCopies: false, recordResult: false });
  });
});

describe('workFinalOverrideIssues — HR changing the manager\'s decision needs a reason', () => {
  const base = (o: Partial<WorkReview> = {}) => reviewRow({ managerDisciplineScore: 90, finalDisciplineScore: 90, ...o });
  const same = ['a', 'b', 'c'].map((t) => item(t, { managerScore: 90, finalScore: 90 }));
  it('the same as the manager → nothing to explain', () => {
    expect(workFinalOverrideIssues(base(), same, tasks, cfg)).toEqual([]);
  });
  it('a task score changed: that item\'s comment, ref = the task', () => {
    const changed = [item('a', { managerScore: 90, finalScore: 80 }), ...same.slice(1)];
    expect(workFinalOverrideIssues(base(), changed, tasks, cfg).map((i) => `${i.ref}:${i.detail}`)).toEqual(['a:FINAL_REASON_REQUIRED']);
    expect(workFinalOverrideIssues(base(), [{ ...changed[0], finalComment: 'Đã xác minh lại' }, ...same.slice(1)], tasks, cfg)).toEqual([]);
  });
  it('KLcv changed: the form\'s reason; float noise is no change', () => {
    expect(workFinalOverrideIssues(base({ finalDisciplineScore: 85 }), same, tasks, cfg).map((i) => i.ref)).toEqual(['finalComment']);
    expect(workFinalOverrideIssues(base({ finalDisciplineScore: 85, finalComment: 'Lý do' }), same, tasks, cfg)).toEqual([]);
    expect(workFinalOverrideIssues(base({ finalDisciplineScore: 90 + 1e-12 }), same, tasks, cfg)).toEqual([]);
  });
  it('a leftover Hsnv that is not required is not a change; a different required Hsnv is', () => {
    expect(workFinalOverrideIssues(base({ managerHsnv: 70, finalHsnv: 75 }), same, tasks, cfg)).toEqual([]); // Hsht 90: not required
    const low = ['a', 'b', 'c'].map((t) => item(t, { managerScore: 60, finalScore: 60 }));
    const r = base({ managerDisciplineScore: 60, finalDisciplineScore: 60, managerHsnv: 70, finalHsnv: 75 });
    expect(workFinalOverrideIssues(r, low, tasks, cfg).map((i) => i.ref)).toEqual(['finalComment']);
  });
});

describe('the hand calculation (hr-performance-expert, B3)', () => {
  it('50/30/20 scored 100/80/0 → KQcv 74; KLcv 90 → Hsht 78.8 → Hsnv required', () => {
    const k = kqcv(tasks, [score('a', 100), score('b', 80), score('c', 0)]);
    expect(k).toBeCloseTo(74, 9);
    const h = hsht(k, 90, cfg);
    expect(h).toBeCloseTo(78.8, 9);
    expect(hsnvRequired(h, cfg)).toBe(true);
  });
  it('33.33 / 33.33 / 33.34 all scored 80, KLcv 80 → Hsht 80: not required', () => {
    const thirds = [task('a', 33.33), task('b', 33.33), task('c', 33.34)];
    const h = hsht(kqcv(thirds, [score('a', 80), score('b', 80), score('c', 80)]), 80, cfg);
    expect(hsnvRequired(h, cfg)).toBe(false);
  });
  it('a 60 / 40 configuration', () => {
    expect(hsht(70, 90, { ...cfg, resultWeight: 60, disciplineWeight: 40 })).toBeCloseTo(78, 9);
  });
});

describe('displayWorkScore / sameWorkScore', () => {
  it('2 decimals, never rounded up across the threshold', () => {
    expect(displayWorkScore(78.8)).toBe(78.8);
    expect(displayWorkScore(79.996, 80)).toBe(79.99);
    expect(displayWorkScore(79.996)).toBe(80);
    expect(displayWorkScore(80, 80)).toBe(80);
    expect(displayWorkScore(null)).toBeNull();
    expect(displayWorkScore(Number.NaN)).toBeNull();
  });
  it('0 is a value; both empty are equal', () => {
    expect(sameWorkScore(0, null)).toBe(false);
    expect(sameWorkScore(null, null)).toBe(true);
    expect(sameWorkScore(80, 80 + 1e-12)).toBe(true);
  });
});

describe('reviewColumnsShown', () => {
  const steps = [{ stepNo: 1, evaluationColumn: 'SELF' as const }, { stepNo: 2, evaluationColumn: 'MANAGER' as const }, { stepNo: 3, evaluationColumn: 'FINAL' as const }];
  it('the columns of the steps reached; all once closed', () => {
    expect(reviewColumnsShown(steps, 1)).toEqual(['SELF']);
    expect(reviewColumnsShown(steps, 2)).toEqual(['SELF', 'MANAGER']);
    expect(reviewColumnsShown(steps, null)).toEqual(['SELF', 'MANAGER', 'FINAL']);
  });
});
