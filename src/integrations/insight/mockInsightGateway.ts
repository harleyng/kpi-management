import { PERIOD_RESULT_STATUS_LABEL, type Id } from '@/data/types';
import { AT_RISK_ACHIEVEMENT_PCT, rankSnapshotUnits, type DashboardSnapshot, type SnapshotUnit } from '@/lib/dashboardRules';
import { KpiError } from '@/lib/errorCatalog';
import { formatNumber } from '@/lib/utils';
import { MAX_QUESTION_LENGTH, SUGGESTED_QUESTIONS, type Insight, type InsightGateway, type InsightIntent, type InsightSentence } from './types';

/**
 * The deterministic AI stand-in (WBS 4.7.4, BR-KPI-89). It PHRASES the snapshot it is given — every
 * number in its text is a snapshot field, quoted through `figureRefs` — and never computes or reads
 * anything else, so the same snapshot always gives the same words and a demo is repeatable.
 *
 * ⚠️ Never import this file outside `src/integrations/insight/`. Use `getInsightGateway()`.
 */

const points = (n: number) => formatNumber(n, 2);
const signed = (n: number) => (n > 0 ? `+${points(n)}` : n < 0 ? `−${points(Math.abs(n))}` : '0');
const say = (text: string, ...figureRefs: string[]): InsightSentence => ({ text, figureRefs });
const insight = (intent: InsightIntent, sentences: InsightSentence[]): Insight => ({ intent, sentences, adapter: 'mock', simulated: true });

/** The snapshot must be the caller's tenant's — the assistant never reads across tenants. */
function guard(tenantId: Id, snapshot: DashboardSnapshot) {
  if (snapshot.tenantId !== tenantId) throw new KpiError('ERR-KPI-06', 'insight: the snapshot belongs to another tenant');
}

function ref(snapshot: DashboardSnapshot, unit: SnapshotUnit, field: keyof SnapshotUnit): string {
  return unit.id === snapshot.focus.id ? `focus.${field}` : `children[${unit.id}].${field}`;
}

function scoreSentence(snapshot: DashboardSnapshot, unit: SnapshotUnit): InsightSentence {
  if (!unit.hasOwnPlan) {
    if (unit.staffAverage === null) return say(`${unit.name} không có kế hoạch riêng và chưa có nhân viên nào có kết quả đã chốt trong kỳ ${snapshot.periodLabel}.`);
    return say(
      `${unit.name} không có kế hoạch riêng. Điểm trung bình nhân viên kỳ ${snapshot.periodLabel} là ${points(unit.staffAverage)} (${unit.staffCounted}/${unit.staffTotal} người có kết quả đã chốt, không trọng số).`,
      ref(snapshot, unit, 'staffAverage'),
      ref(snapshot, unit, 'staffCounted'),
      ref(snapshot, unit, 'staffTotal'),
    );
  }
  if (unit.score === null || unit.status === null) return say(`${unit.name} chưa có kết quả kỳ ${snapshot.periodLabel}.`);
  const rating = unit.ratingCode ? `, xếp loại ${unit.ratingCode}` : ', chưa xếp loại';
  return say(
    `${unit.name} đạt ${points(unit.score)} điểm kỳ ${snapshot.periodLabel} (${PERIOD_RESULT_STATUS_LABEL[unit.status].toLowerCase()}${rating}).`,
    ref(snapshot, unit, 'score'),
    ref(snapshot, unit, 'status'),
    ref(snapshot, unit, 'ratingCode'),
  );
}

function changeSentence(snapshot: DashboardSnapshot, unit: SnapshotUnit): InsightSentence {
  if (!snapshot.previousPeriodLabel) return say(`Kỳ ${snapshot.periodLabel} là kỳ đầu của chu kỳ, chưa có kỳ trước để so sánh.`);
  if (unit.deltaPoints === null) return say(`Chưa so sánh được ${unit.name} với kỳ ${snapshot.previousPeriodLabel}: một trong hai kỳ chưa có điểm.`);
  const provisional = unit.deltaProvisional ? ' (tạm tính)' : '';
  return say(`So với kỳ ${snapshot.previousPeriodLabel}, ${unit.name} ${signed(unit.deltaPoints)} điểm${provisional}.`, ref(snapshot, unit, 'deltaPoints'), ref(snapshot, unit, 'deltaProvisional'));
}

function bestWorstSentences(snapshot: DashboardSnapshot): InsightSentence[] {
  const ranked = rankSnapshotUnits(snapshot.children);
  if (ranked.length < 2) return [say(`Chưa đủ đơn vị trực thuộc có điểm riêng để so sánh trong kỳ ${snapshot.periodLabel}.`)];
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const out = [
    say(`Cao nhất: ${best.name} (${points(best.score as number)}). Thấp nhất: ${worst.name} (${points(worst.score as number)}).`, ref(snapshot, best, 'score'), ref(snapshot, worst, 'score')),
  ];
  const flagged = snapshot.children.filter((c) => c.flagged);
  if (flagged.length > 0) out.push(say(`Xếp loại thấp: ${flagged.map((f) => `${f.name} (${f.ratingCode ?? '—'})`).join(', ')}.`, ...flagged.map((f) => ref(snapshot, f, 'ratingCode'))));
  return out;
}

function attentionSentences(snapshot: DashboardSnapshot): InsightSentence[] {
  if (snapshot.attention === null) return [say(`Chưa có số liệu chỉ tiêu của ${snapshot.focus.name} trong kỳ ${snapshot.periodLabel} để xét chỉ tiêu cần chú ý.`)];
  const below = snapshot.attention.filter((a) => a.kind === 'BELOW_THRESHOLD');
  const missing = snapshot.attention.filter((a) => a.kind === 'MISSING');
  if (below.length === 0 && missing.length === 0) return [say(`Không có chỉ tiêu nào của ${snapshot.focus.name} dưới ngưỡng ${AT_RISK_ACHIEVEMENT_PCT}% hay thiếu số liệu trong kỳ ${snapshot.periodLabel}.`)];
  const out: InsightSentence[] = [];
  if (below.length > 0) {
    const named = below.filter((a) => a.name !== null).slice(0, 3);
    const hidden = below.filter((a) => a.name === null).length;
    const list = named.map((a) => `${a.name} (${points(a.achievementPct as number)}%)`).join(', ');
    const tail = hidden > 0 ? `${list ? '; ' : ''}và ${hidden} chỉ tiêu không thuộc phạm vi xem` : '';
    out.push(say(`${below.length} chỉ tiêu dưới ngưỡng ${AT_RISK_ACHIEVEMENT_PCT}%: ${list}${tail}.`, 'attention'));
  }
  if (missing.length > 0) out.push(say(`${missing.length} chỉ tiêu thiếu số liệu, chưa tính được % hoàn thành.`, 'attention'));
  return out;
}

function overdueSentence(snapshot: DashboardSnapshot): InsightSentence {
  if (snapshot.overdueForms === null) return say('Chưa có số liệu phiếu quá hạn — mở tab "Vận hành" để xem.');
  if (snapshot.overdueForms === 0) return say('Không có phiếu nào quá hạn trong phạm vi bạn xem.', 'overdueForms');
  return say(`${snapshot.overdueForms} phiếu đang quá hạn trong phạm vi bạn xem (chi tiết ở tab "Vận hành").`, 'overdueForms');
}

/** Lower-case, no diacritics, single spaces — so "Quá hạn", "qua han" and "QUÁ HẠN" match alike. */
function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const INTENT_WORDS: readonly [InsightIntent, readonly string[]][] = [
  ['OVERDUE', ['qua han', 'tre han', 'cham han', 'phieu']],
  ['ATTENTION', ['chu y', 'canh bao', 'duoi nguong', 'rui ro', 'thieu so lieu', 'chi tieu nao']],
  ['BEST_WORST', ['cao nhat', 'thap nhat', 'tot nhat', 'kem nhat', 'xep hang']],
  ['CHANGE', ['so voi', 'ky truoc', 'thang truoc', 'thay doi', 'bien dong', 'tang giam', 'tang hay giam']],
  ['UNIT_SCORE', ['diem', 'ket qua', 'xep loai', 'bao nhieu']],
];

/** Whole words only: "giám đốc" must not read as "giảm". */
const hasPhrase = (text: string, phrase: string) => ` ${text} `.includes(` ${phrase} `);

export function intentOf(question: string): InsightIntent {
  const q = normalise(question);
  return INTENT_WORDS.find(([, words]) => words.some((w) => hasPhrase(q, w)))?.[0] ?? 'UNSUPPORTED';
}

/** A child named in the question ("điểm của Marketing"), else the focus. */
function unitAskedAbout(snapshot: DashboardSnapshot, question: string): SnapshotUnit {
  const q = normalise(question);
  return snapshot.children.find((c) => hasPhrase(q, normalise(c.name)) || hasPhrase(q, normalise(c.name.replace(/^(Phòng|Khối|Ban)\s+/i, '')))) ?? snapshot.focus;
}

export const mockInsightGateway: InsightGateway = {
  adapter: 'mock',

  async summarise(tenantId, snapshot) {
    guard(tenantId, snapshot);
    const sentences = [scoreSentence(snapshot, snapshot.focus), changeSentence(snapshot, snapshot.focus)];
    if (snapshot.children.length > 0) sentences.push(...bestWorstSentences(snapshot));
    sentences.push(...attentionSentences(snapshot), overdueSentence(snapshot));
    return insight('SUMMARY', sentences);
  },

  async explain(tenantId, snapshot, nodeId) {
    guard(tenantId, snapshot);
    const unit = nodeId === snapshot.focus.id ? snapshot.focus : snapshot.children.find((c) => c.id === nodeId);
    if (!unit) throw new KpiError('ERR-KPI-06', 'insight: the unit is not on the viewer\'s screen');
    const sentences = [scoreSentence(snapshot, unit), changeSentence(snapshot, unit)];
    if (unit.id === snapshot.focus.id) sentences.push(...attentionSentences(snapshot));
    else sentences.push(say(`Mở ${unit.name} để xem chỉ tiêu nào kéo điểm xuống.`));
    return insight('EXPLAIN', sentences);
  },

  async ask(tenantId, snapshot, question) {
    guard(tenantId, snapshot);
    const text = question.trim();
    if (text.length === 0 || text.length > MAX_QUESTION_LENGTH) throw new KpiError('ERR-KPI-06', `insight: a question must have 1–${MAX_QUESTION_LENGTH} characters`);
    const intent = intentOf(text);
    switch (intent) {
      case 'OVERDUE':
        return insight(intent, [overdueSentence(snapshot)]);
      case 'ATTENTION':
        return insight(intent, attentionSentences(snapshot));
      case 'BEST_WORST':
        return insight(intent, bestWorstSentences(snapshot));
      case 'CHANGE':
        return insight(intent, [changeSentence(snapshot, unitAskedAbout(snapshot, text))]);
      case 'UNIT_SCORE':
        return insight(intent, [scoreSentence(snapshot, unitAskedAbout(snapshot, text))]);
      default:
        return insight('UNSUPPORTED', [
          say('Trợ lý giả lập chỉ trả lời từ số liệu đang hiển thị. Bạn có thể hỏi:'),
          ...SUGGESTED_QUESTIONS.map((q) => say(`• ${q}`)),
        ]);
    }
  },
};
