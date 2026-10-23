import { describe, expect, it } from 'vitest';
import { ENTITY_NAMES } from '@/data/types';
import { newGateway } from '@/integrations/data/mock/gateway.test-util';
import { buildSeed, SEED_VERSION } from './index';

/**
 * GATE 1 FREEZE (plan §6.2, 2026-10-19). From Gate 1 the fixtures and the DataGateway contract are
 * the contract between the seven Phase 2 tracks: they all build on the same seed in parallel.
 *
 * If a test below fails, you changed the seed or the contract. That is a LARGE change:
 *   1. system-architect reviews it (`.claude/agents/system-architect.md`);
 *   2. every other track is told what changed and why;
 *   3. bump SEED_VERSION (src/data/fixtures/index.ts), so browsers reseed;
 *   4. update FROZEN below (the failure message prints the new hash / the diff);
 *   5. log it with /log-decision.
 */
const FROZEN = {
  // Re-frozen 2026-10-23 by Plan A's A1 (evaluation items), then for Plan B step 8.1 (PEND-14): six
  // monthly-work entities, the Kinh doanh pilot seed, a review only on a Locked plan with a live task (Q69).
  seedVersion: '2027-04-06.A1.B1.A2',
  seedHash: '49bcdc28b7f14',
  entityCount: 55,
} as const;

/** `group.method:kind[:permission]` — the gateway surface and each write's declared authorization. */
const FROZEN_CONTRACT: readonly string[] = [
  'actuals.addEvidence:write:evidence.upload',
  'actuals.commitImport:write:actual.import',
  'actuals.deleteEvidence:write:evidence.upload',
  'actuals.deleteMapping:write:datasource.manage',
  'actuals.getImportBatch:read',
  'actuals.listActuals:read',
  'actuals.listConnections:read',
  'actuals.listDataSources:read',
  'actuals.listEvidence:read',
  'actuals.listImportBatches:read',
  'actuals.listMappings:read',
  'actuals.listSyncRuns:read',
  'actuals.recordActual:write:actual.enter',
  'actuals.rejectImport:write:actual.import',
  'actuals.runSync:write:actual.import',
  'actuals.saveConnection:write:datasource.manage',
  'actuals.saveDataSource:write:datasource.manage',
  'actuals.saveMapping:write:datasource.manage',
  'actuals.stageImport:write:actual.import',
  'forms.act:write:workflow',
  'forms.cancelLaunch:write:form.launch',
  'forms.createLaunch:write:form.launch',
  'forms.getForm:read',
  'forms.getLaunch:read',
  'forms.listDelegations:read',
  'forms.listEvaluationItems:read',
  'forms.listFormActions:read',
  'forms.listForms:read',
  'forms.listGoalChangeItems:read',
  'forms.listInbox:read',
  'forms.listLaunchRules:read',
  'forms.listLaunches:read',
  'forms.listWorkflowSteps:read',
  'forms.listWorkflows:read',
  'forms.revokeDelegation:write:delegation.manage',
  'forms.saveDelegation:write:delegation.manage',
  'forms.saveEvaluationItems:write:workflow',
  'forms.saveGoalChangeItems:write:workflow',
  'forms.saveLaunchRule:write:form.launch',
  'forms.saveWorkflow:write:cycle.manage',
  'forms.startForm:write:form.start',
  'goals.createGoalPlan:write:goalplan.edit',
  'goals.deleteAlignment:write:goalplan.edit',
  'goals.deleteGoal:write:goalplan.edit',
  'goals.deleteKgi:write:goalplan.edit',
  'goals.getCycle:read',
  'goals.getGoal:read',
  'goals.getGoalPlan:read',
  'goals.listAlignments:read',
  'goals.listCycles:read',
  'goals.listGoalPlans:read',
  'goals.listGoals:read',
  'goals.listKgis:read',
  'goals.listPeriodTargets:read',
  'goals.listPeriods:read',
  'goals.listTargetLevels:read',
  'goals.lockGoalPlan:write:goalplan.lock',
  'goals.saveAlignment:write:goalplan.edit',
  'goals.saveCycle:write:cycle.manage',
  'goals.saveGoal:write:goalplan.edit',
  'goals.saveKgi:write:goalplan.edit',
  'goals.savePeriods:write:cycle.manage',
  'goals.setCycleStatus:write:cycle.manage',
  'goals.setPeriodLocked:write:cycle.manage',
  'goals.setPeriodTargets:write:goalplan.edit',
  'goals.setTargetLevels:write:goalplan.edit',
  'goals.unlockGoalPlan:write:goalplan.lock',
  'library.getKpiDefinition:read',
  'library.listCalcMethods:read',
  'library.listCalcTiers:read',
  'library.listKpiDefinitions:read',
  'library.listKpiTemplateItems:read',
  'library.listKpiTemplates:read',
  'library.listMeasureUnits:read',
  'library.listPerspectives:read',
  'library.saveCalcMethod:write:library.manage',
  'library.saveKpiDefinition:write:library.manage',
  'library.saveKpiTemplate:write:library.manage',
  'library.saveMeasureUnit:write:library.manage',
  'library.savePerspective:write:library.manage',
  'org.deleteUserRole:write:user.manage',
  'org.getEmployee:read',
  'org.getUserAccount:read',
  'org.listAssignments:read',
  'org.listEmployees:read',
  'org.listOrgUnits:read',
  'org.listPermissions:read',
  'org.listPositions:read',
  'org.listRolePermissions:read',
  'org.listRoles:read',
  'org.listUserAccounts:read',
  'org.listUserRoles:read',
  'org.saveAssignment:write:org.manage',
  'org.saveEmployee:write:org.manage',
  'org.saveOrgUnit:write:org.manage',
  'org.savePosition:write:org.manage',
  'org.saveUserAccount:write:user.manage',
  'org.saveUserRole:write:user.manage',
  'org.setRolePermissions:write:user.manage',
  'platform.getTenant:platform',
  'platform.listTenants:platform',
  'platform.saveTenant:platform',
  'results.calculateResults:write:result.finalize',
  'results.deletePayoutRule:write:rating.config',
  'results.exportPayroll:write:result.export',
  'results.finalizeResults:write:result.finalize',
  'results.listPayoutRules:read',
  'results.listPayrollExports:read',
  'results.listPeriodResults:read',
  'results.listRatingLevels:read',
  'results.listRatingScales:read',
  'results.listResultDetails:read',
  'results.lockResults:write:result.finalize',
  'results.savePayoutRule:write:rating.config',
  'results.saveRatingScale:write:rating.config',
  'results.setAdjustment:write:result.finalize',
  'scheduler.runDue:system',
  'system.getFile:read',
  'system.getFileUrl:read',
  'system.listAuditLog:read',
  'system.listNotificationTemplates:read',
  'system.listNotifications:read',
  'system.markNotificationRead:write:actor',
  'system.recordAudit:system',
  'system.recordNotification:system',
  'system.saveNotificationTemplate:write:notification.manage',
  'system.uploadFile:write:evidence.upload',
  // Plan B step 8.1 (PEND-14, 2026-10-23): monthly work.
  'work.cancelWorkTask:write:workflow',
  'work.getWorkPlan:read',
  'work.getWorkReview:read',
  'work.getWorkScoringConfig:read',
  'work.listWorkPlans:read',
  'work.listWorkResults:read',
  'work.listWorkReviewItems:read',
  'work.listWorkTasks:read',
  'work.listWorkTasksOfPlans:read',
  'work.saveWorkReview:write:workflow',
  'work.saveWorkScoringConfig:write:cycle.manage',
  'work.saveWorkTasks:write:workflow',
  'work.updateTaskProgress:write:workflow',
];

/** JSON with object keys sorted, so the hash depends on the data, not on insertion order. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/** cyrb53 — a small, dependency-free 53-bit string hash (not cryptographic; a change detector). */
function cyrb53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

const LARGE = 'Fixtures/contract changed after Gate 1 = a Large change — see the steps at the top of freeze.test.ts';

describe('Gate 1 freeze — the fixtures and the contract are the contract between tracks', () => {
  it('the seed is deterministic and unchanged since the freeze', () => {
    const hash = cyrb53(stableStringify(buildSeed()));
    expect(cyrb53(stableStringify(buildSeed())), 'buildSeed must be deterministic').toBe(hash);
    expect(SEED_VERSION, LARGE).toBe(FROZEN.seedVersion);
    expect(hash, `${LARGE} (new hash: ${hash})`).toBe(FROZEN.seedHash);
  });

  it('the gateway surface and every write\'s permission are unchanged since the freeze', () => {
    const { gateway } = newGateway();
    const { methods, auth } = gateway.registry;
    const surface = [...methods]
      .map(([name, kind]) => {
        const a = auth.get(name);
        return `${name}:${kind}${a === undefined ? '' : `:${typeof a === 'string' ? a : a.permission}`}`;
      })
      .sort();
    expect(surface, LARGE).toEqual(FROZEN_CONTRACT);
  });

  it('the domain has the same entities', () => {
    expect(ENTITY_NAMES.length, LARGE).toBe(FROZEN.entityCount);
  });
});
