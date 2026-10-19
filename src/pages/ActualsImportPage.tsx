import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shared/PageHeader';
import { ActualEntryTab } from '@/components/actuals/ActualEntryTab';
import { ActualImportTab } from '@/components/actuals/ActualImportTab';
import { CycleSelect, MonthSelect } from '@/components/actuals/CyclePeriodPickers';
import { SyncTab } from '@/components/actuals/SyncTab';
import type { CyclePeriod, Id } from '@/data/types';

const TABS = ['entry', 'import', 'sync'] as const;
type Tab = (typeof TABS)[number];
const isTab = (v: string | null): v is Tab => v !== null && (TABS as readonly string[]).includes(v);

/**
 * "Số liệu & import" (WBS 4.4.2–4.4.5, Track T4) — HR / C&B enter the month's actuals by hand, import
 * them from Excel, or run the API sync. The tab and an opened import batch live in the URL
 * (`?tab=import&batch=…`), so a batch can be linked and the back button works.
 */
export default function ActualsImportPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = isTab(params.get('tab')) ? (params.get('tab') as Tab) : 'entry';
  const batchId = params.get('batch');
  const [cycleId, setCycleId] = useState<Id | null>(null);
  const [period, setPeriod] = useState<CyclePeriod | null>(null);

  const setTab = (next: string) => setParams(next === 'entry' ? {} : { tab: next });
  const openBatch = useCallback((id: Id | null) => setParams(id ? { tab: 'import', batch: id } : { tab: 'import' }), [setParams]);
  const changeCycle = useCallback((id: Id) => {
    setCycleId(id);
    setPeriod(null);
  }, []);

  return (
    <>
      <PageHeader title="Số liệu & import" description="Nhập số thực tế hằng tháng: nhập tay, nhập từ Excel theo lô, hoặc đồng bộ qua kết nối API." actions={<CycleSelect value={cycleId} onChange={changeCycle} />} />
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="entry">Nhập tay</TabsTrigger>
          <TabsTrigger value="import">Nhập từ Excel</TabsTrigger>
          <TabsTrigger value="sync">Đồng bộ API</TabsTrigger>
        </TabsList>
        <TabsContent value="entry" className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Kỳ
            </span>
            <MonthSelect cycleId={cycleId} value={period?.id ?? null} onChange={setPeriod} />
          </div>
          <ActualEntryTab cycleId={cycleId} period={period} />
        </TabsContent>
        <TabsContent value="import">
          <ActualImportTab cycleId={cycleId} batchId={tab === 'import' ? batchId : null} onOpenBatch={openBatch} />
        </TabsContent>
        <TabsContent value="sync">
          <SyncTab cycleId={cycleId} />
        </TabsContent>
      </Tabs>
    </>
  );
}
