import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEMO, SYNTRA } from '@/data/fixtures';
import type { DomainEvent } from '../types';
import { flush, newGateway, rejection } from './gateway.test-util';
import { PAYROLL_MIME_TYPE } from './payrollWorkbook';

/**
 * `results.exportPayroll` (T6, BR-KPI-81): what is written, what is refused, what is announced. What
 * the file SAYS is `payrollRules` (its own tests) and `payrollWorkbook` (round trip).
 */

// jsdom has no blob URLs; the browser does.
beforeAll(() => {
  if (typeof URL.createObjectURL !== 'function') URL.createObjectURL = vi.fn(() => 'blob:mock/test');
});

const S = SYNTRA.tenantId;
const cnb = SYNTRA.user(SYNTRA.personas.cnb);
const hr = SYNTRA.user(SYNTRA.personas.hr);
const admin = SYNTRA.user(SYNTRA.personas.admin);
const cycle = SYNTRA.id('PerformanceCycle', '2027');
const periodId = (label: string) => SYNTRA.id('CyclePeriod', 2027, label);
const T01 = periodId('T01');
const T02 = periodId('T02');
const T03 = periodId('T03');

function listen(gateway: ReturnType<typeof newGateway>['gateway'], tenantId = S) {
  const heard: DomainEvent[] = [];
  gateway.events.subscribe(tenantId, (e) => {
    heard.push(e);
  });
  return heard;
}

describe('results.exportPayroll — writes the file and its record, changes no result', () => {
  it('C&B exports a Locked period: a PayrollExport + an xlsx FileObject at the gateway clock\'s time', async () => {
    const { gateway } = newGateway();
    const resultsBefore = await gateway.results.listPeriodResults(S, { periodId: T01 });
    const heard = listen(gateway);
    const before = gateway.clock.now();
    const record = await gateway.results.exportPayroll(S, cnb, T01);
    const after = gateway.clock.now();

    expect(record).toMatchObject({ tenantId: S, periodId: T01, exportedBy: cnb });
    expect(record.exportedAt >= before && record.exportedAt <= after).toBe(true);
    const file = await gateway.system.getFile(S, record.fileId);
    expect(file).toMatchObject({ tenantId: S, mimeType: PAYROLL_MIME_TYPE, uploadedBy: cnb, uploadedAt: record.exportedAt });
    expect(file.fileName).toMatch(/^luong-kpi_kpi-2027_t01_\d{8}-\d{4}\.xlsx$/);
    expect(file.sizeBytes).toBeGreaterThan(0);
    expect(typeof (await gateway.system.getFileUrl(S, record.fileId))).toBe('string');

    expect(await gateway.results.listPeriodResults(S, { periodId: T01 })).toEqual(resultsBefore);
    await flush();
    const exported = heard.filter((e) => e.type === 'payroll.exported');
    expect(exported).toEqual([expect.objectContaining({ periodId: T01, exportId: record.id, actorUserId: cnb })]);
    expect(heard.some((e) => e.type.startsWith('results.'))).toBe(false);
    const changed = heard.flatMap((e) => (e.type === 'entity.changed' ? [`${e.entityName}:${e.action}`] : []));
    expect(changed.sort()).toEqual(['FileObject:CREATE', 'PayrollExport:CREATE']);
  });

  it('exports a Final period too (ASSUMPTION Q38), and every export is its own record and file', async () => {
    const { gateway } = newGateway();
    const first = await gateway.results.exportPayroll(S, cnb, T02);
    await gateway.results.lockResults(S, admin, T02);
    const second = await gateway.results.exportPayroll(S, cnb, T02);
    expect(second.id).not.toBe(first.id);
    expect(second.fileId).not.toBe(first.fileId);
    const listed = await gateway.results.listPayrollExports(S, T02);
    expect(listed.map((e) => e.id)).toEqual([second.id, first.id]);
    expect(await gateway.results.listPayrollExports(S, T01)).toEqual([]);
    expect((await gateway.system.getFile(S, first.fileId)).uploadedAt).toBe(first.exportedAt); // the first file is untouched
  });

  it('a Closed cycle still exports — exporting computes nothing', async () => {
    const { gateway } = newGateway();
    await gateway.goals.setCycleStatus(S, admin, cycle, 'Evaluating');
    await gateway.goals.setCycleStatus(S, admin, cycle, 'Closed');
    await expect(gateway.results.exportPayroll(S, cnb, T01)).resolves.toMatchObject({ periodId: T01 });
  });
});

describe('results.exportPayroll — refusals write nothing', () => {
  async function nothingWritten(gateway: ReturnType<typeof newGateway>['gateway'], heard: DomainEvent[]) {
    await flush();
    expect(heard).toEqual([]);
    expect(await gateway.results.listPayrollExports(S)).toEqual([]);
  }

  it('needs result.export: HR, an employee and a manager are refused (ERR-KPI-05)', async () => {
    const { gateway } = newGateway();
    const heard = listen(gateway);
    for (const actor of [hr, SYNTRA.user(SYNTRA.personas.employee), SYNTRA.user(SYNTRA.personas.manager), SYNTRA.user(SYNTRA.personas.bod)]) {
      const error = await rejection(gateway.results.exportPayroll(S, actor, T01));
      expect(error.code, actor).toBe('ERR-KPI-05');
      expect(error.detail).toContain('result.export');
    }
    await nothingWritten(gateway, heard);
  });

  it('a period with no Final / Locked employee result (T03: unit Drafts only) → ERR-KPI-04 NO_FINAL_RESULT', async () => {
    const { gateway } = newGateway();
    const heard = listen(gateway);
    const error = await rejection(gateway.results.exportPayroll(S, cnb, T03));
    expect([error.code, error.detail]).toEqual(['ERR-KPI-04', 'NO_FINAL_RESULT']);
    await nothingWritten(gateway, heard);
  });

  it('an unknown period → ERR-KPI-02', async () => {
    const { gateway } = newGateway();
    expect((await rejection(gateway.results.exportPayroll(S, cnb, 'nowhere'))).code).toBe('ERR-KPI-02');
  });

  it('results locked while the file is being rendered → ERR-KPI-04 CHANGED_DURING_WRITE, nothing recorded', async () => {
    const { gateway } = newGateway();
    const exporting = rejection(gateway.results.exportPayroll(S, cnb, T02));
    await gateway.results.lockResults(S, admin, T02); // commits while the workbook renders
    const error = await exporting;
    expect([error.code, error.detail]).toEqual(['ERR-KPI-04', 'CHANGED_DURING_WRITE']);
    expect(await gateway.results.listPayrollExports(S)).toEqual([]);
    await expect(gateway.results.exportPayroll(S, cnb, T02)).resolves.toMatchObject({ periodId: T02 }); // retry works
  });
});

describe('results.exportPayroll — persistence', () => {
  it('a reload keeps the record but not the bytes: the file then answers ERR-KPI-02 (export again)', async () => {
    const { gateway, storage } = newGateway();
    const record = await gateway.results.exportPayroll(S, cnb, T01);
    const reloaded = newGateway({ storage }).gateway;
    expect((await reloaded.results.listPayrollExports(S, T01)).map((e) => e.id)).toEqual([record.id]);
    expect((await rejection(reloaded.system.getFileUrl(S, record.fileId))).code).toBe('ERR-KPI-02');
  });
});

describe('results.exportPayroll — Demo Co', () => {
  it('Demo Co\'s C&B exports its own period; neither tenant lists the other\'s export or file', async () => {
    const { gateway } = newGateway();
    const D = DEMO.tenantId;
    const demoCnb = DEMO.user(DEMO.personas.cnb);
    const demo = await gateway.results.exportPayroll(D, demoCnb, DEMO.id('CyclePeriod', 'T01'));
    const syntra = await gateway.results.exportPayroll(S, cnb, T01);
    expect((await gateway.results.listPayrollExports(D)).map((e) => e.id)).toEqual([demo.id]);
    expect((await gateway.results.listPayrollExports(S)).map((e) => e.id)).toEqual([syntra.id]);
    expect((await rejection(gateway.system.getFile(D, syntra.fileId))).code).toBe('ERR-KPI-02');
    expect((await rejection(gateway.system.getFile(S, demo.fileId))).code).toBe('ERR-KPI-02');
  });
});
