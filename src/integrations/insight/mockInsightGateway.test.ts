import { describe, expect, it } from 'vitest';
import type { DashboardSnapshot, SnapshotUnit } from '@/lib/dashboardRules';
import { KpiError } from '@/lib/errorCatalog';
import { getInsightGateway } from './index';
import { intentOf } from './mockInsightGateway';
import { MAX_QUESTION_LENGTH, SUGGESTED_QUESTIONS } from './types';

const unit = (o: Partial<SnapshotUnit>): SnapshotUnit => ({
  id: 'u', name: 'Đơn vị', hasOwnPlan: true, score: 95, status: 'Final', ratingCode: 'B', deltaPoints: null,
  deltaProvisional: false, staffAverage: null, staffCounted: 0, staffTotal: 0, flagged: false, ...o,
});

const snapshot: DashboardSnapshot = {
  tenantId: 'tA',
  periodId: 'T02',
  periodLabel: 'T02',
  previousPeriodLabel: 'T01',
  focus: unit({ id: 'kd', name: 'Khối Kinh doanh', hasOwnPlan: false, score: null, status: null, ratingCode: null, staffAverage: 96.5, staffCounted: 8, staffTotal: 10 }),
  children: [
    unit({ id: 'sale', name: 'Phòng Sale', score: 105.45, ratingCode: 'A', deltaPoints: 5.18 }),
    unit({ id: 'mkt', name: 'Phòng Marketing', score: 85.2, ratingCode: 'C', deltaPoints: -2.5, deltaProvisional: true, flagged: true }),
    unit({ id: 'cskh', name: 'Phòng CSKH', hasOwnPlan: false, score: null, status: null, ratingCode: null, staffAverage: 120 }),
  ],
  attention: [
    { name: 'Doanh thu', achievementPct: 80.5, kind: 'BELOW_THRESHOLD' },
    { name: null, achievementPct: 70, kind: 'BELOW_THRESHOLD' },
    { name: 'Tỉ lệ KH cũ', achievementPct: null, kind: 'MISSING' },
  ],
  overdueForms: 3,
};

const gateway = getInsightGateway();
const text = (i: { sentences: { text: string }[] }) => i.sentences.map((s) => s.text).join(' ');

describe('mock InsightGateway (WBS 4.7.4, BR-KPI-89)', () => {
  it('is the mock, labels itself simulated, and is deterministic', async () => {
    const a = await gateway.summarise('tA', snapshot);
    const b = await gateway.summarise('tA', structuredClone(snapshot));
    expect(gateway.adapter).toBe('mock');
    expect(a).toEqual(b);
    expect(a).toMatchObject({ intent: 'SUMMARY', adapter: 'mock', simulated: true });
  });

  it('summarises from the snapshot only: staff average for a Khối, best / worst among OWN-plan units, attention, overdue', async () => {
    const t = text(await gateway.summarise('tA', snapshot));
    expect(t).toContain('Khối Kinh doanh không có kế hoạch riêng. Điểm trung bình nhân viên kỳ T02 là 96,5 (8/10');
    expect(t).toContain('Cao nhất: Phòng Sale (105,45). Thấp nhất: Phòng Marketing (85,2).');
    expect(t).not.toContain('Phòng CSKH (120'); // a staff average is never ranked against plan scores (Q40)
    expect(t).toContain('Xếp loại thấp: Phòng Marketing (C).');
    expect(t).toContain('2 chỉ tiêu dưới ngưỡng 90%: Doanh thu (80,5%); và 1 chỉ tiêu không thuộc phạm vi xem.');
    expect(t).toContain('1 chỉ tiêu thiếu số liệu');
    expect(t).toContain('3 phiếu đang quá hạn');
  });

  it('every number it says is a snapshot value — nothing computed', async () => {
    const insight = await gateway.summarise('tA', snapshot);
    const numbers = text(insight).match(/\d+(?:,\d+)?/g) ?? [];
    const allowed = new Set(['96,5', '8', '10', '105,45', '85,2', '2', '90', '80,5', '1', '3', '02', '01']);
    for (const n of numbers) expect(allowed.has(n), n).toBe(true);
    for (const s of insight.sentences) for (const ref of s.figureRefs) expect(ref).toMatch(/^(focus|children\[(sale|mkt|cskh|kd)\])\.|^(attention|overdueForms)$/);
  });

  it('rejects a snapshot of another tenant (ERR-KPI-06) on every method', async () => {
    await expect(gateway.summarise('tB', snapshot)).rejects.toMatchObject({ code: 'ERR-KPI-06' });
    await expect(gateway.explain('tB', snapshot, 'kd')).rejects.toBeInstanceOf(KpiError);
    await expect(gateway.ask('tB', snapshot, 'Có bao nhiêu phiếu quá hạn?')).rejects.toMatchObject({ code: 'ERR-KPI-06' });
  });

  it('explains the focus or a child on screen, never a unit outside the snapshot', async () => {
    const child = text(await gateway.explain('tA', snapshot, 'mkt'));
    expect(child).toContain('Phòng Marketing đạt 85,2 điểm kỳ T02 (đã chốt, xếp loại C).');
    expect(child).toContain('So với kỳ T01, Phòng Marketing −2,5 điểm (tạm tính).');
    await expect(gateway.explain('tA', snapshot, 'elsewhere')).rejects.toMatchObject({ code: 'ERR-KPI-06' });
  });

  it.each([
    ['Có bao nhiêu phiếu quá hạn?', 'OVERDUE'],
    ['chi tieu nao can chu y', 'ATTENTION'],
    ['Đơn vị nào cao nhất, thấp nhất?', 'BEST_WORST'],
    ['So với kỳ trước thay đổi thế nào?', 'CHANGE'],
    ['Điểm của đơn vị này kỳ này là bao nhiêu?', 'UNIT_SCORE'],
    ['Thời tiết hôm nay?', 'UNSUPPORTED'],
  ] as const)('"%s" → %s', (question, intent) => {
    expect(intentOf(question)).toBe(intent);
  });

  it('every suggested question is understood', () => {
    for (const q of SUGGESTED_QUESTIONS) expect(intentOf(q)).not.toBe('UNSUPPORTED');
  });

  it('answers about a unit named in the question, and refuses the rest by listing what it can answer', async () => {
    expect(text(await gateway.ask('tA', snapshot, 'Điểm của Marketing?'))).toContain('Phòng Marketing đạt 85,2');
    const refusal = await gateway.ask('tA', snapshot, 'Lương của giám đốc?');
    expect(refusal.intent).toBe('UNSUPPORTED');
    expect(text(refusal)).toContain(SUGGESTED_QUESTIONS[0]);
  });

  it('rejects an empty or an oversized question (ERR-KPI-06)', async () => {
    await expect(gateway.ask('tA', snapshot, '   ')).rejects.toMatchObject({ code: 'ERR-KPI-06' });
    await expect(gateway.ask('tA', snapshot, 'x'.repeat(MAX_QUESTION_LENGTH + 1))).rejects.toMatchObject({ code: 'ERR-KPI-06' });
  });

  it('attention not known (no own result, or lines not loaded) is never an all-clear', async () => {
    const unknown = { ...snapshot, attention: null };
    const t = text(await gateway.summarise('tA', unknown));
    expect(t).toContain('Chưa có số liệu chỉ tiêu của Khối Kinh doanh');
    expect(t).not.toContain('Không có chỉ tiêu nào');
    expect(text(await gateway.ask('tA', unknown, 'Chỉ tiêu nào cần chú ý?'))).toContain('Chưa có số liệu chỉ tiêu');
  });

  it('says so when there is no previous period or nothing to rank', async () => {
    const first = { ...snapshot, previousPeriodLabel: null, children: [], attention: [], overdueForms: 0 };
    const t = text(await gateway.summarise('tA', first));
    expect(t).toContain('kỳ đầu của chu kỳ');
    expect(t).toContain('Không có chỉ tiêu nào');
    expect(t).toContain('Không có phiếu nào quá hạn');
  });
});
