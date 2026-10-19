import { useMemo, useState } from 'react';
import { Award, Info, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { EmptyStateCard } from '@/components/shared/EmptyState';
import { SectionTitle } from '@/components/shared/SectionTitle';
import { useSession } from '@/contexts/useSession';
import { PAYOUT_SCOPE_LABEL, type PayoutRule, type PerformanceCycle, type RatingLevel } from '@/data/types';
import { useOrgUnits, usePositions } from '@/hooks/queries/org';
import { useDeletePayoutRule, usePayoutRules } from '@/hooks/queries/results';
import { combineQueries, type QueryState } from '@/lib/queryState';
import { formatDate, formatNumber } from '@/lib/utils';
import { PayoutRuleDialog } from './PayoutRuleDialog';

interface RatingTabProps {
  cycle: PerformanceCycle;
  levels: readonly RatingLevel[] | undefined;
  levelsQuery: QueryState;
  scaleName: string | null;
}

/** "Từ 90 đến dưới 100", "Từ 110 trở lên" — the range as HR reads it (`ratingRules.ratingFor`). */
function rangeText(level: RatingLevel, isTop: boolean): string {
  return isTop ? `Từ ${formatNumber(level.minScore, 2)} trở lên` : `Từ ${formatNumber(level.minScore, 2)} đến dưới ${formatNumber(level.maxScore, 2)}`;
}

/**
 * "Xếp loại & quy đổi" (WBS 4.6.3): the cycle's rating scale, READ-ONLY while it is the sample
 * (`ASSUMPTION Q2`), and the payout rules HR / C&B try out to settle the conversion.
 */
export function RatingTab({ cycle, levels, levelsQuery, scaleName }: RatingTabProps) {
  const { can } = useSession();
  const mayEdit = can('rating.config');
  const scaleId = cycle.ratingScaleId;
  const rules = usePayoutRules(scaleId);
  const units = useOrgUnits();
  const positions = usePositions();
  const remove = useDeletePayoutRule();
  const [editing, setEditing] = useState<PayoutRule | 'new' | null>(null);
  const [deleting, setDeleting] = useState<PayoutRule | null>(null);

  const sortedLevels = useMemo(() => (levels ? [...levels].sort((a, b) => b.minScore - a.minScore) : undefined), [levels]);
  const topId = sortedLevels?.[0]?.id;
  const levelById = useMemo(() => new Map((levels ?? []).map((l) => [l.id, l])), [levels]);
  const sortedRules = useMemo(
    () =>
      rules.data
        ? [...rules.data].sort(
            (a, b) =>
              (levelById.get(b.ratingLevelId)?.minScore ?? 0) - (levelById.get(a.ratingLevelId)?.minScore ?? 0) ||
              a.appliesTo.localeCompare(b.appliesTo) ||
              (a.effectiveFrom < b.effectiveFrom ? 1 : -1),
          )
        : undefined,
    [rules.data, levelById],
  );

  if (scaleId === null) {
    return <EmptyStateCard>Chu kỳ {cycle.name} chưa gắn thang xếp loại, nên kết quả chưa được xếp loại.</EmptyStateCard>;
  }

  const levelColumns: DataTableColumn<RatingLevel>[] = [
    { id: 'code', header: 'Xếp loại', cell: (l) => <span className="font-medium">{l.code}</span> },
    { id: 'label', header: 'Tên', cell: (l) => l.label },
    { id: 'range', header: 'Khoảng điểm KPI', cell: (l) => <span className="tabular">{rangeText(l, l.id === topId)}</span> },
  ];

  const scopeOf = (rule: PayoutRule) =>
    rule.appliesTo === 'OrgUnit'
      ? (units.data?.find((u) => u.id === rule.orgUnitId)?.name ?? 'Đơn vị không còn')
      : rule.appliesTo === 'Position'
        ? (positions.data?.find((p) => p.id === rule.positionId)?.name ?? 'Chức danh không còn')
        : null;

  const ruleColumns: DataTableColumn<PayoutRule>[] = [
    { id: 'level', header: 'Xếp loại', cell: (r) => <span className="font-medium">{levelById.get(r.ratingLevelId)?.code ?? 'Không tìm thấy'}</span> },
    { id: 'scope', header: 'Áp dụng cho', cell: (r) => PAYOUT_SCOPE_LABEL[r.appliesTo] },
    { id: 'target', header: 'Đơn vị / chức danh', cell: (r) => scopeOf(r) },
    { id: 'pct', header: '% hưởng lương KPI', numeric: true, cell: (r) => <span className="tabular">{formatNumber(r.payoutPct, 2)}</span> },
    { id: 'from', header: 'Hiệu lực từ', cell: (r) => formatDate(r.effectiveFrom) },
    ...(mayEdit
      ? [
          {
            id: 'actions',
            header: 'Thao tác',
            className: 'w-24',
            cell: (r: PayoutRule) => (
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(r)} aria-label={`Sửa quy tắc ${levelById.get(r.ratingLevelId)?.code ?? ''}`}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDeleting(r)} aria-label={`Xóa quy tắc ${levelById.get(r.ratingLevelId)?.code ?? ''}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <SectionTitle icon={Award} title={scaleName ?? 'Thang xếp loại'}>
          Kết quả được xếp loại theo điểm KPI đã làm tròn.
        </SectionTitle>
        <p className="flex items-start gap-2 rounded-md bg-support-warning-subtle px-3 py-2 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-support-warning" aria-hidden />
          Thang xếp loại mẫu (giả định Q2), chờ HR/C&B xác nhận. Thang chỉ xem, chưa sửa trên màn hình này.
        </p>
        <DataTable label="Các mức xếp loại" columns={levelColumns} rows={sortedLevels} query={levelsQuery} getRowId={(l) => l.id} empty="Thang này chưa có mức nào." pageSize={null} />
      </section>

      <section className="space-y-3">
        <SectionTitle
          icon={Wallet}
          title="Quy tắc quy đổi % hưởng lương KPI"
          action={
            mayEdit ? (
              <Button size="sm" onClick={() => setEditing('new')} disabled={!levels || levels.length === 0}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                Thêm quy tắc
              </Button>
            ) : undefined
          }
        >
          Quy tắc cụ thể nhất đang có hiệu lực được áp dụng: theo chức danh, rồi theo đơn vị gần nhất, rồi cho tất cả.
        </SectionTitle>
        <DataTable
          label="Quy tắc quy đổi"
          columns={ruleColumns}
          rows={sortedRules}
          query={combineQueries([rules, units, positions])}
          getRowId={(r) => r.id}
          empty="Chưa có quy tắc quy đổi nào. Kết quả đã xếp loại sẽ chưa có % hưởng lương KPI."
          pageSize={null}
        />
        <p className="text-xs text-muted-foreground">
          Thay đổi chỉ áp dụng cho kết quả chưa chốt. Bấm "Tính lại kết quả" ở tab Kết quả kỳ để cập nhật.
          {!mayEdit && ' Chỉ HR và C&B sửa được quy tắc.'}
        </p>
      </section>

      {editing !== null && levels && (
        <PayoutRuleDialog
          rule={editing === 'new' ? null : editing}
          ratingScaleId={scaleId}
          levels={levels}
          units={units.data ?? []}
          positions={positions.data ?? []}
          unitsQuery={units}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Xóa quy tắc ${deleting ? (levelById.get(deleting.ratingLevelId)?.code ?? '') : ''}?`}
        body="Kết quả đã chốt không đổi. Bản tạm tính đổi % hưởng lương KPI khi tính lại."
        confirmLabel="Xóa quy tắc"
        destructive
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}
