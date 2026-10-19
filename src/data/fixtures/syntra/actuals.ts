import type { ActualImportRow, FileObject, Goal, GoalActual, GoalPlan, Id, ImportRowError, SourceType, SyncRun } from '@/data/types';
import { createPrng } from '../prng';
import type { IdFn, Library, SeedRows } from '../shared';
import { vn } from '../timeline';
import type { SyntraGoals } from './goals';
import type { SyntraOrg } from './org';

/**
 * Three months of actuals (T01–T03) with all three sources (BR-KPI-52), as the period close left
 * them on the morning the evaluation launched:
 * - API — ERP Sale syncs at 06:00 on day 1 (T02 partly failed: one record missing; T03's first run
 *   failed overnight and the 06:00 rerun succeeded);
 * - EXCEL — HR's monthly batch at 07:30 on day 1; in T03 the CRM file is a SEPARATE batch still
 *   Validating with row errors, so CRM goals have NO T03 actual yet (a missing actual, BR-KPI-32);
 * - MANUAL — entered by the goal owner by 08:30 on day 1.
 * One T02 Excel value was corrected by hand on 03-05, after the T02 forms opened (the form keeps
 * its snapshot, BR-KPI-17).
 *
 * Values are drawn around the monthly target with a fixed-seed generator — data, not a calculation.
 */

const MONTHS = ['T01', 'T02', 'T03'] as const;
type Month = (typeof MONTHS)[number];
const NEXT_DAY_1: Record<Month, string> = { T01: '2027-02-01', T02: '2027-03-01', T03: '2027-04-01' };

export interface SyntraActuals {
  /** The actual that was current at `instant` for (goal, month), if any. */
  currentAt(goalId: Id, month: string, instant: string): GoalActual | null;
  /** The actual current now (SEED_NOW). */
  current(goalId: Id, month: string): GoalActual | null;
  hrUserId: Id;
  files: { evidence: FileObject };
}

export function buildActuals(s: SeedRows, id: IdFn, org: SyntraOrg, lib: Library, g: SyntraGoals): SyntraActuals {
  const prng = createPrng(20270101);
  const hrUserId = org.userId('E035');

  // ─── Files (seeded: rows without stored bytes; `getFileUrl` serves a placeholder) ────────────
  const file = (key: string, fileName: string, mimeType: string, sizeBytes: number, at: string, by: Id = hrUserId) =>
    s.add('FileObject', { id: id('FileObject', key), storageKey: `seed/${fileName}`, fileName, mimeType, sizeBytes, uploadedBy: by, uploadedAt: at });
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const batchFile = {
    T01: file('actuals-T01', 'so-lieu-thuc-te-T01-2027.xlsx', XLSX, 48_213, vn('2027-02-01 07:25')),
    T02: file('actuals-T02', 'so-lieu-thuc-te-T02-2027.xlsx', XLSX, 49_870, vn('2027-03-01 07:25')),
    T03: file('actuals-T03', 'so-lieu-thuc-te-T03-2027.xlsx', XLSX, 47_532, vn('2027-04-01 07:25')),
    crmT03: file('actuals-T03-crm', 'so-lieu-cskh-T03-2027.xlsx', XLSX, 12_904, vn('2027-04-01 08:10')),
    library: file('library-import', 'thu-vien-kpi-bo-sung.xlsx', XLSX, 9_480, vn('2027-02-20 14:00')),
  };
  const evidence = file('evidence-1', 'bien-ban-nghiem-thu-T03.pdf', 'application/pdf', 182_337, vn('2027-04-03 16:20'), org.userId('E022'));

  // ─── ERP Sale connection, mappings, sync runs (WBS 4.4.4–4.4.5, simulated) ─────────────────
  const erp = lib.source('ERP_SALE');
  const connectionId = id('IntegrationConnection', 'ERP_SALE');
  s.add('IntegrationConnection', {
    id: connectionId,
    dataSourceId: erp.id,
    endpoint: 'https://erp-sale.example/api/v1',
    authType: 'APIKey',
    secretRef: 'vault://syntra/erp-sale/api-key',
    scheduleCron: '0 6 1 * *',
    status: 'Active',
  });
  for (const k of s.rows.KpiDefinition.filter((k) => k.defaultDataSourceId === erp.id)) {
    s.add('DataMapping', { id: id('DataMapping', k.code), connectionId, kpiDefId: k.id, queryOrPath: `/kpi/${k.code}?period={period}`, orgDimension: 'employee_code', transformExpr: null });
  }
  const runs: Record<Month, SyncRun> = {} as Record<Month, SyncRun>;
  const run = (key: string, month: Month, start: string, end: string, status: SyncRun['status'], errorLog: string | null) =>
    s.add('SyncRun', { id: id('SyncRun', key), connectionId, periodId: g.period(month).id, startedAt: vn(start), finishedAt: vn(end), recordsOk: 0, recordsError: 0, status, errorLog });
  runs.T01 = run('T01', 'T01', '2027-02-01 06:00', '2027-02-01 06:04', 'Succeeded', null);
  runs.T02 = run('T02', 'T02', '2027-03-01 06:00', '2027-03-01 06:05', 'PartiallyFailed', 'Không ánh xạ được 1 bản ghi: mã nhân viên KD-099 không tồn tại.');
  run('T03-failed', 'T03', '2027-03-31 23:00', '2027-03-31 23:02', 'Failed', 'Hết thời gian chờ kết nối ERP Sale.');
  runs.T03 = run('T03', 'T03', '2027-04-01 06:00', '2027-04-01 06:04', 'Succeeded', null);

  // ─── Actuals ─────────────────────────────────────────────────────────────────────────────────
  const sourceTypeOf = new Map(s.rows.DataSource.map((d) => [d.id, d.sourceType]));
  const crmId = lib.source('CRM_CSKH').id;
  const planOf = new Map(s.rows.GoalPlan.map((p) => [p.id, p]));
  const excelRows: Record<string, ActualImportRow[]> = { T01: [], T02: [], T03: [], crmT03: [] };
  const batchId = (key: string) => id('ImportBatch', key);
  let skippedApiInT02 = false;

  const valueFor = (goal: Goal): { value: number | null; text: string | null } => {
    if (goal.targetType === 'TEXT') return { value: null, text: prng.next() < 0.85 ? 'Đạt' : 'Không đạt' };
    if (goal.calcMethodId === lib.method('CM-STOCKOUT').id) return { value: prng.int(0, 2), text: null };
    const levels = s.rows.GoalTargetLevel.filter((l) => l.goalId === goal.id).map((l) => l.targetValue as number);
    if (levels.length > 0) return { value: round2(prng.between(Math.min(...levels), Math.max(...levels))), text: null };
    const target = g.monthlyTarget(goal) ?? 0;
    const raw = target * prng.between(0.82, 1.18);
    return { value: Math.abs(raw) >= 1000 ? Math.round(raw) : round2(raw), text: null };
  };

  const add = (goal: Goal, month: Month, sourceType: SourceType, at: string, value: { value: number | null; text: string | null }, extra: Partial<GoalActual> = {}) =>
    s.add('GoalActual', {
      id: id('GoalActual', goal.id, month, extra.isCurrent === false ? 'old' : 'cur'),
      goalId: goal.id,
      periodId: g.period(month).id,
      actualValue: value.value,
      actualText: value.text,
      sourceType,
      batchId: null,
      syncRunId: null,
      enteredBy: null,
      note: null,
      recordedAt: at,
      isCurrent: true,
      ...extra,
    });

  const inScope = (goal: Goal, month: Month): boolean => {
    const plan = planOf.get(goal.goalPlanId) as GoalPlan;
    if (plan.cycleId !== g.cycleId) return false;
    if (goal.id === g.change.modified.id || goal.id === g.change.cancelled.id) return month === 'T01';
    if (goal.id === g.change.replacement.id || goal.id === g.change.added.id) return month !== 'T01';
    if (plan.ownerEmployeeId === org.employeeId('E024') && month === 'T03') return false; // left on 03-10
    return true;
  };

  const ownerUser = (goal: Goal) => {
    const owner = s.rows.Employee.find((e) => e.id === goal.ownerEmployeeId);
    return owner ? org.userId(owner.employeeCode) : hrUserId;
  };

  for (const month of MONTHS) {
    const day1 = NEXT_DAY_1[month];
    for (const goal of s.rows.Goal) {
      if (!inScope(goal, month)) continue;
      const sourceType = sourceTypeOf.get(goal.dataSourceId) as SourceType;
      const value = valueFor(goal);
      if (sourceType === 'API') {
        // T02's partly failed run: one record never arrived.
        if (month === 'T02' && !skippedApiInT02) {
          skippedApiInT02 = true;
          continue;
        }
        add(goal, month, 'API', runs[month].finishedAt as string, value, { syncRunId: runs[month].id });
        continue;
      }
      if (sourceType === 'EXCEL') {
        const crm = goal.dataSourceId === crmId && month === 'T03';
        const rows = excelRows[crm ? 'crmT03' : month];
        rows.push({ rowNo: rows.length + 2, goalId: goal.id, login: null, kpiCode: null, periodLabel: month, actualValue: value.value, actualText: value.text, note: null, evidenceUrl: null });
        if (crm) continue; // staged, not committed — no actual yet
        add(goal, month, 'EXCEL', vn(`${day1} 08:00`), value, { batchId: batchId(month), enteredBy: hrUserId });
        continue;
      }
      add(goal, month, 'MANUAL', vn(`${day1} 08:30`), value, { enteredBy: ownerUser(goal) });
    }
  }

  // The corrected T02 value: E022's first Excel goal, fixed by the CSKH head on 03-05.
  const corrected = s.rows.Goal.find((goal) => goal.ownerEmployeeId === org.employeeId('E022') && sourceTypeOf.get(goal.dataSourceId) === 'EXCEL') as Goal;
  const original = s.rows.GoalActual.find((a) => a.goalId === corrected.id && a.periodId === g.period('T02').id) as GoalActual;
  const index = s.rows.GoalActual.indexOf(original);
  s.rows.GoalActual[index] = { ...original, id: id('GoalActual', corrected.id, 'T02', 'old'), isCurrent: false };
  add(corrected, 'T02', 'MANUAL', vn('2027-03-05 10:00'), { value: original.actualValue === null ? null : round2(original.actualValue * 0.97), text: original.actualText }, {
    enteredBy: org.userId('E008'),
    note: 'Điều chỉnh sau đối soát CRM',
  });

  // Sync run counts follow the rows they loaded.
  for (const month of MONTHS) {
    const r = runs[month];
    const ok = s.rows.GoalActual.filter((a) => a.syncRunId === r.id).length;
    const index_ = s.rows.SyncRun.indexOf(r);
    s.rows.SyncRun[index_] = { ...r, recordsOk: ok, recordsError: r.status === 'PartiallyFailed' ? 1 : 0 };
  }

  // ─── Import batches ──────────────────────────────────────────────────────────────────────────
  const batch = (key: string, fileObj: FileObject, rows: ActualImportRow[], errors: ImportRowError[], status: 'Committed' | 'Validating', at: string) =>
    s.add('ImportBatch', {
      id: batchId(key),
      importType: 'Actual',
      cycleId: g.cycleId,
      fileId: fileObj.id,
      uploadedBy: hrUserId,
      rows,
      rowsTotal: rows.length,
      rowsError: new Set(errors.map((e) => e.rowNo)).size,
      errors,
      status,
      createdAt: at,
    });
  batch('T01', batchFile.T01, excelRows.T01, [], 'Committed', vn('2027-02-01 07:30'));
  batch('T02', batchFile.T02, excelRows.T02, [], 'Committed', vn('2027-03-01 07:30'));
  batch('T03', batchFile.T03, excelRows.T03, [], 'Committed', vn('2027-04-01 07:30'));
  const crm = excelRows.crmT03;
  const bad1 = crm.length + 2;
  crm.push({ rowNo: bad1, goalId: null, login: 'nam.hv2', kpiCode: 'KPI-TL-KHIEU-NAI', periodLabel: 'T03', actualValue: 2.1, actualText: null, note: null, evidenceUrl: null });
  crm.push({ rowNo: bad1 + 1, goalId: crm[0].goalId, login: null, kpiCode: null, periodLabel: 'T03', actualValue: null, actualText: null, note: 'Chưa có số', evidenceUrl: null });
  batch('T03-crm', batchFile.crmT03, crm, [
    { rowNo: bad1, column: 'Tên đăng nhập', code: 'ERR-KPI-06', detail: 'Không tìm thấy người dùng nam.hv2' },
    { rowNo: bad1 + 1, column: 'Giá trị thực tế', code: 'ERR-KPI-06', detail: 'Thiếu giá trị thực tế' },
  ], 'Validating', vn('2027-04-01 08:15'));
  s.add('ImportBatch', {
    id: batchId('library-rejected'),
    importType: 'Library',
    cycleId: null,
    fileId: batchFile.library.id,
    uploadedBy: hrUserId,
    rows: [
      { rowNo: 2, code: 'KPI-NPS', name: 'Chỉ số hài lòng NPS', perspectiveCode: 'CUS', unitCode: 'PCT', calcMethodCode: 'CM-UP', definition: null, formulaText: null, frequency: 'Month', aggregation: 'AVG' },
      { rowNo: 3, code: 'KPI-THOI-GIAN-GIAO', name: 'Thời gian giao hàng', perspectiveCode: 'KH', unitCode: 'DAY', calcMethodCode: 'CM-DOWN', definition: null, formulaText: null, frequency: 'Month', aggregation: 'AVG' },
    ],
    rowsTotal: 2,
    rowsError: 1,
    errors: [{ rowNo: 3, column: 'Mã viễn cảnh', code: 'ERR-KPI-06', detail: 'Mã viễn cảnh "KH" không có trong danh mục' }],
    status: 'Rejected',
    createdAt: vn('2027-02-20 14:05'),
  });

  const actualsByKey = new Map<string, GoalActual[]>();
  for (const a of s.rows.GoalActual) {
    const key = `${a.goalId}|${a.periodId}`;
    actualsByKey.set(key, [...(actualsByKey.get(key) ?? []), a]);
  }
  const currentAt = (goalId: Id, month: string, instant: string) =>
    (actualsByKey.get(`${goalId}|${g.period(month).id}`) ?? [])
      .filter((a) => a.recordedAt <= instant)
      .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1))[0] ?? null;

  return {
    currentAt,
    current: (goalId, month) => (actualsByKey.get(`${goalId}|${g.period(month).id}`) ?? []).find((a) => a.isCurrent) ?? null,
    hrUserId,
    files: { evidence },
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
