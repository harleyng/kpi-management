import { useState } from 'react';
import { Download, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toastError, toastSuccess } from '@/components/shared/notify';
import { useSession } from '@/contexts/useSession';
import { BSC_PERSPECTIVE_LABEL } from '@/data/types';
import {
  useCalcMethods,
  useKpiDefinitions,
  useKpiTemplateItems,
  useKpiTemplates,
  useMeasureUnits,
  usePerspectives,
} from '@/hooks/queries/library';
import { useDataSources } from '@/hooks/queries/actuals';
import { useOrgUnits, usePositions } from '@/hooks/queries/org';
import { libraryExportRows, templateExportRows } from '@/lib/libraryRules';
import { downloadBlob } from '@/lib/utils';

/**
 * "Xuất Excel" — the whole library (items, templates, code lists) in one workbook, from what the
 * screen already read. Library import arrives with T4's shared import framework (WBS 4.4.3); until
 * then its button is shown disabled with the reason in words.
 */
export function LibraryActions() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" disabled title="Nhập thư viện từ Excel sẽ có khi khung import chung hoàn thành.">
        <Upload className="h-4 w-4" aria-hidden />
        Nhập từ Excel (sắp có)
      </Button>
      <LibraryExportButton />
    </div>
  );
}

export function LibraryExportButton() {
  const { today } = useSession();
  const queries = {
    definitions: useKpiDefinitions(),
    perspectives: usePerspectives(),
    units: useMeasureUnits(),
    methods: useCalcMethods(),
    dataSources: useDataSources(),
    templates: useKpiTemplates(),
    items: useKpiTemplateItems(),
    orgUnits: useOrgUnits(),
    positions: usePositions(),
  };
  const [busy, setBusy] = useState(false);
  const failed = Object.values(queries).some((q) => q.error != null);
  const ready = Object.values(queries).every((q) => q.data !== undefined);

  const exportNow = async () => {
    const { definitions, perspectives, units, methods, dataSources, templates, items, orgUnits, positions } = queries;
    if (!definitions.data || !perspectives.data || !units.data || !methods.data || !dataSources.data || !templates.data || !items.data || !orgUnits.data || !positions.data) return;
    setBusy(true);
    try {
      const { buildLibraryWorkbook } = await import('./exportLibrary');
      const blob = await buildLibraryWorkbook({
        library: libraryExportRows(definitions.data, {
          perspectives: perspectives.data,
          units: units.data,
          methods: methods.data,
          dataSources: dataSources.data,
        }),
        templates: templateExportRows(templates.data, items.data, {
          definitions: definitions.data,
          orgUnits: orgUnits.data,
          positions: positions.data,
        }),
        catalogues: [
          { title: 'Viễn cảnh BSC', rows: perspectives.data.map((p) => ({ code: p.code, name: p.name || BSC_PERSPECTIVE_LABEL[p.code] })) },
          { title: 'Đơn vị đo', rows: units.data },
          { title: 'Phương pháp tính', rows: methods.data },
          { title: 'Nguồn dữ liệu', rows: dataSources.data },
        ],
      });
      downloadBlob(blob, `thu-vien-kpi-${today}.xlsx`);
      toastSuccess('Đã xuất Excel');
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void exportNow()}
      disabled={!ready || busy}
      aria-busy={busy || undefined}
      title={failed ? 'Không tải được dữ liệu để xuất.' : undefined}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
      Xuất Excel
    </Button>
  );
}
