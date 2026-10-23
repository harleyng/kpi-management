import { describe, expect, it } from 'vitest';
import {
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
