import { describe, expect, it } from 'vitest';
import { goal, kpiDefinition, kpiTemplate, templateItem } from '@/test/builders';
import { templateApplication, templatesForPlan } from './templateApplyRules';

describe('templatesForPlan — which templates "Thêm từ bộ mẫu" offers', () => {
  const pos = kpiTemplate({ id: 'pos', name: 'Chuyên viên', positionId: 'p-spec' });
  const otherPos = kpiTemplate({ id: 'pos2', name: 'Trưởng nhóm', positionId: 'p-lead' });
  const dept = kpiTemplate({ id: 'dept', name: 'Phòng Kinh doanh', orgUnitId: 'kdbh' });
  const division = kpiTemplate({ id: 'div', name: 'Khối Kinh doanh', orgUnitId: 'kd' });
  const otherUnit = kpiTemplate({ id: 'mkt', name: 'Marketing', orgUnitId: 'mkt' });
  const general = kpiTemplate({ id: 'gen', name: 'Chung' });
  const draft = kpiTemplate({ id: 'draft', name: 'Nháp', status: 'Draft' });
  const archived = kpiTemplate({ id: 'arch', name: 'Cũ', status: 'Archived', orgUnitId: 'kdbh' });
  const all = [general, otherUnit, division, dept, otherPos, pos, draft, archived];
  const ids = (ts: { id: string }[]) => ts.map((t) => t.id);

  it('suggests position, then the unit and the units above it (nearest first), then general; the rest by name', () => {
    const r = templatesForPlan(all, { positionId: 'p-spec', unitIds: ['kdbh', 'kd', 'root'] });
    expect(ids(r.suggested)).toEqual(['pos', 'dept', 'div', 'gen']);
    expect(ids(r.others)).toEqual(['mkt', 'pos2']);
  });

  it('a unit plan has no position: unit templates and general ones are suggested', () => {
    const r = templatesForPlan(all, { positionId: null, unitIds: ['kd', 'root'] });
    expect(ids(r.suggested)).toEqual(['div', 'gen']);
    expect(ids(r.others)).toEqual(['pos', 'mkt', 'dept', 'pos2']);
  });

  it('never offers a Draft or Archived template', () => {
    const r = templatesForPlan([draft, archived], { positionId: null, unitIds: ['kdbh'] });
    expect([...r.suggested, ...r.others]).toEqual([]);
  });
});

describe('templateApplication — what applying a template adds (BR-KPI-77)', () => {
  const revenue = kpiDefinition({ id: 'rev', name: 'Doanh thu', perspectiveId: 'p-fin', unitId: 'u-vnd', calcMethodId: 'cm-up', defaultDataSourceId: 'erp', definition: 'Doanh thu ghi nhận' });
  const customers = kpiDefinition({ id: 'cus', name: 'Số khách hàng', perspectiveId: 'p-cus', defaultDataSourceId: 'crm' });
  const noSource = kpiDefinition({ id: 'nos', name: 'Chưa có nguồn', defaultDataSourceId: null });
  const archived = kpiDefinition({ id: 'old', name: 'Cũ', status: 'Archived' });
  const kpis = [revenue, customers, noSource, archived];
  const fields = { goalPlanId: 'plan9', ownerEmployeeId: 'e1', startDate: '2029-01-01', dueDate: '2029-12-31', firstSortOrder: 3 };
  const items = [
    templateItem({ id: 'i1', kpiDefId: 'rev', defaultWeight: 40, defaultTarget: 1_000 }),
    templateItem({ id: 'i2', kpiDefId: 'cus', defaultWeight: 20, defaultTarget: null }),
    templateItem({ id: 'i3', kpiDefId: 'nos', defaultWeight: 10 }),
    templateItem({ id: 'i4', kpiDefId: 'old', defaultWeight: 10 }),
    templateItem({ id: 'i5', kpiDefId: 'missing', defaultWeight: 10 }),
  ];

  it('builds each goal from its library KPI with the item\'s defaults, in template order after the plan\'s goals', () => {
    const r = templateApplication(items, kpis, [], fields);
    expect(r.toAdd.map((g) => [g.kpiDefId, g.weight, g.targetValue, g.sortOrder])).toEqual([
      ['rev', 40, 1_000, 3],
      ['cus', 20, null, 4],
    ]);
    expect(r.toAdd[0]).toMatchObject({
      goalPlanId: 'plan9', name: 'Doanh thu', description: 'Doanh thu ghi nhận', perspectiveId: 'p-fin', unitId: 'u-vnd',
      calcMethodId: 'cm-up', dataSourceId: 'erp', visibility: 'PUBLIC', targetType: 'NUMERIC', ownerEmployeeId: 'e1',
      startDate: '2029-01-01', dueDate: '2029-12-31', kgiId: null,
    });
    expect(r.toAdd[0]).not.toHaveProperty('targetLevels');
  });

  it('skips, with the reason, a KPI without a data source, one no longer Active, and an unknown one', () => {
    const r = templateApplication(items, kpis, [], fields);
    expect(r.rows.map((row) => [row.item.id, row.skip])).toEqual([
      ['i1', null],
      ['i2', null],
      ['i3', 'NO_DATA_SOURCE'],
      ['i4', 'KPI_NOT_ACTIVE'],
      ['i5', 'KPI_NOT_ACTIVE'],
    ]);
  });

  it('never replaces: a KPI already Active in the plan is skipped; a cancelled goal of it does not count', () => {
    const existing = [goal({ kpiDefId: 'rev', weight: 30 }), goal({ id: 'g2', kpiDefId: 'cus', status: 'Cancelled', weight: 20 })];
    const r = templateApplication(items.slice(0, 2), kpis, existing, fields);
    expect(r.rows.map((row) => row.skip)).toEqual(['ALREADY_IN_PLAN', null]);
    expect(r.toAdd.map((g) => g.kpiDefId)).toEqual(['cus']);
  });

  it('a KPI listed twice adds once', () => {
    const r = templateApplication([items[0], { ...items[0], id: 'dup' }], kpis, [], fields);
    expect(r.toAdd).toHaveLength(1);
    expect(r.rows[1].skip).toBe('ALREADY_IN_PLAN');
  });

  it('reports the weight and the count the plan will have — warnings, never a refusal', () => {
    const existing = [goal({ kpiDefId: 'x', weight: 30 }), goal({ id: 'g2', kpiDefId: 'y', status: 'Cancelled', weight: 50 })];
    const r = templateApplication(items, kpis, existing, fields);
    expect(r.weightAfter).toBe(90);
    expect(r.countAfter).toBe(3);
    expect(r.withoutTarget).toBe(1); // "Số khách hàng" has no default target
    const zero = templateApplication([{ ...items[0], defaultWeight: 0 }], kpis, [], fields);
    expect(zero.zeroWeight).toBe(1);
  });
});
