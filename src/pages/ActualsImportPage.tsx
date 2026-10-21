import { LaterPhaseNotice } from '@/components/shared/LaterPhaseNotice';
import { PageHeader } from '@/components/shared/PageHeader';
import { ActualEntryTab } from '@/components/actuals/ActualEntryTab';
import { ActualImportTab } from '@/components/actuals/ActualImportTab';
import { CycleSelect, MonthSelect } from '@/components/actuals/CyclePeriodPickers';
import { SyncTab } from '@/components/actuals/SyncTab';
import { useCyclePeriodParams } from '@/components/actuals/useCyclePeriodParams';

export type ActualsSection = 'entry' | 'import' | 'sync';

const SECTIONS: Record<ActualsSection, { title: string; description: string }> = {
  entry: { title: 'Nhập tay', description: 'Nhập số thực tế từng chỉ tiêu của một tháng, kèm minh chứng.' },
  import: { title: 'Nhập từ Excel', description: 'Tải mẫu của tháng, điền số liệu rồi tải lên thành lô; kiểm tra lô trước khi ghi nhận.' },
  sync: { title: 'Đồng bộ API', description: 'Các kết nối API đổ số tự động: chạy đồng bộ một tháng và xem lịch sử chạy.' },
};

/**
 * "Số liệu & import" (WBS 4.4.2–4.4.5, Track T4) — HR / C&B enter the month's actuals by hand, import
 * them from Excel, or run the API sync; one sub-page per way in. The cycle and month live in the URL
 * (`?cycle=&period=`), which the menu carries between the three. An import batch and a connection
 * open on their own pages (`ActualsDetailPages.tsx`).
 */
export default function ActualsImportPage({ section }: { section: ActualsSection }) {
  const { cycleId, period, setCycle, setPeriod, search } = useCyclePeriodParams({ withPeriod: section === 'entry' });
  const { title, description } = SECTIONS[section];

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            <CycleSelect value={cycleId} onChange={setCycle} />
            {section === 'entry' && <MonthSelect cycleId={cycleId} value={period?.id ?? null} onChange={setPeriod} />}
          </>
        }
      />
      {section === 'entry' ? (
        <ActualEntryTab cycleId={cycleId} period={period} />
      ) : section === 'import' ? (
        <ActualImportTab cycleId={cycleId} search={search} />
      ) : (
        <>
          <LaterPhaseNotice className="mb-4" />
          <SyncTab cycleId={cycleId} search={search} />
        </>
      )}
    </>
  );
}
