import type { JobPosition, OrgUnit } from '@/data/types';
import { JOB_LEVEL_LABEL, ORG_UNIT_TYPE_LABEL } from '@/data/types';
import { ORG_DATA_COLUMNS } from '../orgImportRules';
import type { TemplateSpec } from './workbook';

export const ORG_DATA_TEMPLATE_FILE = 'mau-nhap-to-chuc-nhan-su.xlsx';

/** WBS 4.1.7 — the "Tổ chức & nhân sự" template: the input sheet plus the tenant's Active codes. */
export function orgDataTemplateSpec(units: readonly OrgUnit[], positions: readonly JobPosition[]): TemplateSpec {
  const byCode = <T extends { code: string }>(rows: readonly T[]) => [...rows].sort((a, b) => a.code.localeCompare(b.code, 'vi'));
  return {
    sheets: [
      { name: 'Nhân sự', columns: ORG_DATA_COLUMNS, sampleRows: [ORG_DATA_COLUMNS.map((c) => c.example)] },
      {
        name: 'Mã đơn vị',
        table: { headers: ['Mã đơn vị', 'Tên đơn vị', 'Loại'], rows: byCode(units.filter((u) => u.status === 'Active')).map((u) => [u.code, u.name, ORG_UNIT_TYPE_LABEL[u.unitType]]) },
      },
      {
        name: 'Mã chức danh',
        table: { headers: ['Mã chức danh', 'Tên chức danh', 'Cấp bậc'], rows: byCode(positions.filter((p) => p.status === 'Active')).map((p) => [p.code, p.name, JOB_LEVEL_LABEL[p.jobLevel]]) },
      },
    ],
  };
}
