import type {
  CyclePeriod,
  FormInstance,
  FormLaunch,
  FormStatus,
  GoalVisibility,
  Id,
  IsoDate,
  RecipientFilter,
  StepAction,
  WorkPlan,
  WorkPlanStatus,
  WorkReview,
  WorkTask,
  WorkTaskStatus,
} from '@/data/types';
import { DEFAULT_WORK_SCORING, workResultOf } from '@/lib/workRules';
import { WORK_PLAN_BOTTOM_UP_STEP } from './catalog';
import type { IdFn, SeedRows, Workflows } from './shared';

/**
 * Monthly work rows (PEND-14) for one tenant: plans, tasks, the WORK_PLAN / WORK_REVIEW forms and their
 * history, the reviews and — for a recorded month — the `WorkResult`, PRODUCED by `workRules.workResultOf`
 * from the FINAL column (never typed in). Forms replay from their actions, like the KPI forms.
 */

export interface TaskSpec {
  name: string;
  weight: number;
  product?: string;
  unitText?: string;
  visibility?: GoalVisibility;
  linkedGoalId?: Id;
  progressPct: number;
  progressStatus: Exclude<WorkTaskStatus, 'Cancelled'>;
  /** Cancelled by the manager on this date (`ASSUMPTION Q64`). */
  cancelled?: { at: string; by: string; reason: string };
}

/** Per task (in plan order), `[self, manager, final]`; KLcv the same; Hsnv only when Hsht < 80. */
export interface ReviewSpec {
  tasks: readonly (readonly [number | null, number | null, number | null])[];
  discipline: readonly [number | null, number | null, number | null];
  hsnv?: { score: number; reason: string };
}

export interface WorkDeps {
  s: SeedRows;
  id: IdFn;
  wf: Workflows;
  user(code: string): Id;
  employee(code: string): Id;
  period(label: string): CyclePeriod;
}

export function workSeed(d: WorkDeps) {
  const { s, id, wf } = d;
  const seq = new Map<Id, number>();
  const plans = new Map<string, WorkPlan>();
  const tasks = new Map<Id, WorkTask[]>();

  const launch = (key: string, l: { type: 'WORK_PLAN' | 'WORK_REVIEW'; name: string; month: string; cycleId: Id; at: string; dueDays: number; filter: RecipientFilter | null; by: string }): FormLaunch =>
    s.add('FormLaunch', {
      id: id('FormLaunch', key),
      workflowId: wf.id(l.type),
      formType: l.type,
      name: l.name,
      timing: 'NOW',
      scheduledAt: l.at,
      launchRuleId: null,
      cycleId: l.cycleId,
      periodId: d.period(l.month).id,
      dueDays: l.dueDays,
      recipientMode: l.filter ? 'FILTER' : 'ALL',
      recipientFilter: l.filter,
      status: 'Launched',
      launchedAt: l.at,
      createdBy: d.user(l.by),
      createdAt: l.at,
      // The seed's monthly plans are written by the employee first (bottom-up).
      startStepNo: l.type === 'WORK_PLAN' ? WORK_PLAN_BOTTOM_UP_STEP : null,
    });

  const plan = (code: string, month: string, status: WorkPlanStatus, approved: { at: string; by: string } | null, specs: readonly TaskSpec[]): WorkPlan => {
    const period = d.period(month);
    const row = s.add('WorkPlan', {
      id: id('WorkPlan', code, month),
      employeeId: d.employee(code),
      periodId: period.id,
      status,
      approvedAt: approved?.at ?? null,
      approvedBy: approved ? d.user(approved.by) : null,
    });
    plans.set(`${code}:${month}`, row);
    const list = specs.map((t, i) =>
      s.add('WorkTask', {
        id: id('WorkTask', code, month, i + 1),
        workPlanId: row.id,
        sortOrder: i,
        name: t.name,
        product: t.product ?? null,
        description: null,
        unitText: t.unitText ?? null,
        weight: t.weight,
        startDate: period.startDate,
        dueDate: period.endDate,
        progressPct: t.progressPct,
        progressStatus: t.cancelled ? 'Cancelled' : t.progressStatus,
        note: null,
        visibility: t.visibility ?? 'PUBLIC',
        linkedGoalId: t.linkedGoalId ?? null,
        createdBy: d.user(code),
        cancelledAt: t.cancelled?.at ?? null,
        cancelledBy: t.cancelled ? d.user(t.cancelled.by) : null,
        cancelReason: t.cancelled?.reason ?? null,
      }),
    );
    tasks.set(row.id, list);
    return row;
  };

  const form = (
    key: string,
    f: { type: 'WORK_PLAN' | 'WORK_REVIEW'; code: string; month: string; launch: FormLaunch; due: IsoDate; status: FormStatus; step: number | null; enteredAt: string | null },
  ): FormInstance =>
    s.add('FormInstance', {
      id: id('FormInstance', key),
      workflowId: wf.id(f.type),
      formType: f.type,
      subjectEmployeeId: d.employee(f.code),
      goalPlanId: null,
      workPlanId: (plans.get(`${f.code}:${f.month}`) as WorkPlan).id,
      periodId: d.period(f.month).id,
      currentStepId: f.step === null ? null : wf.step(f.type, f.step).id,
      currentStepEnteredAt: f.enteredAt,
      overdueHandledAt: null,
      status: f.status,
      dueDate: f.due,
      launchedAt: f.launch.launchedAt as string,
      launchId: f.launch.id,
    });

  const act = (f: FormInstance, stepNo: number, by: string, action: StepAction, at: string, comment: string | null = null) => {
    const n = (seq.get(f.id) ?? 0) + 1;
    seq.set(f.id, n);
    s.add('FormStepAction', {
      id: id('FormStepAction', f.id, n),
      formId: f.id,
      stepId: wf.step(f.formType, stepNo).id,
      actorUserId: d.user(by),
      onBehalfOfUserId: null,
      delegationId: null,
      action,
      comment,
      actedAt: at,
    });
  };

  /** The review of `f` (one item per task live at launch) and, when `recordedAt` is given, the month's result. */
  const review = (f: FormInstance, spec: ReviewSpec, recordedAt: string | null = null): WorkReview => {
    const workPlanId = f.workPlanId as Id;
    const [selfK, managerK, finalK] = spec.discipline;
    const row = s.add('WorkReview', {
      id: id('WorkReview', f.id),
      formId: f.id,
      workPlanId,
      selfDisciplineScore: selfK,
      selfComment: selfK === null ? null : 'Đã hoàn thành các việc chính trong tháng.',
      managerDisciplineScore: managerK,
      managerComment: managerK === null ? null : 'Đồng ý với kết quả tự đánh giá, có điều chỉnh.',
      managerHsnv: managerK === null ? null : (spec.hsnv?.score ?? null),
      managerHsnvReason: managerK === null ? null : (spec.hsnv?.reason ?? null),
      finalDisciplineScore: finalK,
      finalComment: null,
      finalHsnv: finalK === null ? null : (spec.hsnv?.score ?? null),
      finalHsnvReason: finalK === null ? null : (spec.hsnv?.reason ?? null),
    });
    const live = (tasks.get(workPlanId) ?? []).filter((t) => t.cancelledAt === null || t.cancelledAt > (f.launchedAt as string));
    const items = live.map((t, i) => {
      const [self, manager, final] = spec.tasks[i] ?? [null, null, null];
      return s.add('WorkReviewItem', {
        id: id('WorkReviewItem', f.id, t.id),
        formId: f.id,
        taskId: t.id,
        selfScore: self,
        selfComment: null,
        managerScore: manager,
        managerComment: null,
        finalScore: final,
        finalComment: null,
      });
    });
    if (recordedAt !== null) {
      const workPlan = [...plans.values()].find((p) => p.id === workPlanId) as WorkPlan;
      s.add('WorkResult', {
        id: id('WorkResult', workPlanId),
        employeeId: workPlan.employeeId,
        periodId: workPlan.periodId,
        workPlanId,
        formId: f.id,
        ...workResultOf(row, items, tasks.get(workPlanId) ?? [], DEFAULT_WORK_SCORING),
        recordedAt,
      });
    }
    return row;
  };

  return { launch, plan, form, act, review, tasksOf: (p: WorkPlan) => tasks.get(p.id) ?? [] };
}
