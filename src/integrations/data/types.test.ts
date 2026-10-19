import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Goal, ImportBatch, RatingLevel, WorkflowStep } from '@/data/types';
import {
  GATEWAY_GROUPS,
  SYNC_GATEWAY_GROUPS,
  type ChildInput,
  type FormActionInput,
  type GoalsGateway,
  type NewLaunchInput,
  type StageImportInput,
  type Upsert,
} from './types';

/**
 * Compile-time guarantees of the contract (checked by `npm run typecheck`, which includes this
 * file). Each `@ts-expect-error` is a promise the Phase 1.1 review asked the contract to keep; if a
 * future edit breaks one, typecheck fails on the now-unused directive.
 */
describe('DataGateway contract — compile-time guarantees', () => {
  it('types import rows per import type, so two types can never be mixed', () => {
    const actualRow = {
      rowNo: 2, goalId: 'g1', login: null, kpiCode: null, periodLabel: 'T01',
      actualValue: 10, actualText: null, note: null, evidenceUrl: null,
    };
    const ok: StageImportInput = { importType: 'Actual', fileId: 'f1', cycleId: 'c1', rows: [actualRow] };
    // @ts-expect-error — an Actual row is not a Library row
    const mixed: StageImportInput = { importType: 'Library', fileId: 'f1', cycleId: null, rows: [actualRow] };
    expect([ok, mixed]).toHaveLength(2);

    const batch = {} as ImportBatch;
    if (batch.importType === 'Actual') expectTypeOf(batch.rows[0].periodLabel).toEqualTypeOf<string>();
  });

  it('keeps managed columns out of the caller\'s hands', () => {
    type GoalInput = Parameters<GoalsGateway['saveGoal']>[2];
    expectTypeOf<GoalInput>().not.toHaveProperty('status');
    expectTypeOf<GoalInput>().not.toHaveProperty('replacesGoalId');
    expectTypeOf<GoalInput>().not.toHaveProperty('tenantId');
    expectTypeOf<Upsert<Goal>>().toHaveProperty('id');
  });

  it('lets a child keep its id across an aggregate save (no orphaned step or level ids)', () => {
    expectTypeOf<ChildInput<WorkflowStep, 'workflowId' | 'stepNo'>>().toHaveProperty('id');
    expectTypeOf<ChildInput<RatingLevel, 'ratingScaleId'>>().toHaveProperty('id');
  });

  it('never lets a person record a system or EDIT action', () => {
    // @ts-expect-error — AUTO_FORWARD is the scheduler's
    const auto: FormActionInput['action'] = 'AUTO_FORWARD';
    // @ts-expect-error — EDIT is a permission, not a recorded action
    const edit: FormActionInput['action'] = 'EDIT';
    expect([auto, edit]).toHaveLength(2);
  });

  it('requires a date only for a SCHEDULED launch', () => {
    type Base = Omit<NewLaunchInput, 'timing' | 'scheduledAt'>;
    const base = {} as Base;
    const now: NewLaunchInput = { ...base, timing: 'NOW' };
    // @ts-expect-error — SCHEDULED needs scheduledAt
    const scheduled: NewLaunchInput = { ...base, timing: 'SCHEDULED' };
    expect([now, scheduled]).toHaveLength(2);
  });
});

describe('GATEWAY_GROUPS', () => {
  it('lists each group once, and the synchronous ones are among them', () => {
    expect(new Set(GATEWAY_GROUPS).size).toBe(GATEWAY_GROUPS.length);
    for (const group of SYNC_GATEWAY_GROUPS) expect(GATEWAY_GROUPS).toContain(group);
  });
});
