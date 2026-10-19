import { useId, useState } from 'react';
import { Download, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { BlockedReason } from '@/components/shared/BlockedReason';
import { Button } from '@/components/ui/button';
import type { OrgDirectory } from '@/hooks/queries/org';
import { ERROR_CATALOG } from '@/lib/errorCatalog';
import { downloadBlob } from '@/lib/utils';

/**
 * WBS 4.1.7 — the template works now; importing waits for the shared import framework (T4, 4.4.3),
 * so the button is disabled with the reason as visible text, never a fake.
 */
export function ImportActions({ directory }: { directory: OrgDirectory | undefined }) {
  const [busy, setBusy] = useState(false);
  const reasonId = useId();

  const download = async () => {
    if (!directory) return;
    setBusy(true);
    try {
      const [{ buildTemplateWorkbook }, { orgDataTemplateSpec, ORG_DATA_TEMPLATE_FILE }] = await Promise.all([import('@/lib/excel/workbook'), import('@/lib/excel/orgDataTemplate')]);
      downloadBlob(await buildTemplateWorkbook(orgDataTemplateSpec(directory.units, directory.positions)), ORG_DATA_TEMPLATE_FILE);
    } catch {
      const spec = ERROR_CATALOG['ERR-KPI-01'];
      toast.error(spec.title, spec.message ? { description: spec.message } : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={download} disabled={!directory || busy} aria-busy={busy || undefined}>
          {busy ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Download aria-hidden />}
          Tải mẫu nhập
        </Button>
        <Button variant="outline" size="sm" disabled aria-describedby={reasonId}>
          <Upload aria-hidden />
          Nhập từ file
        </Button>
      </div>
      <BlockedReason id={reasonId}>Nhập từ file sẽ có khi khung nhập dữ liệu hoàn tất.</BlockedReason>
    </div>
  );
}
