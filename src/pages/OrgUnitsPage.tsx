import { EmployeesTab } from '@/components/org/EmployeesTab';
import { OrgStructureTab } from '@/components/org/OrgStructureTab';
import { PositionsTab } from '@/components/org/PositionsTab';
import { TenantTab } from '@/components/org/TenantTab';
import { PageHeader } from '@/components/shared/PageHeader';

export type OrgSection = 'structure' | 'employees' | 'positions' | 'company';

const SECTIONS: Record<OrgSection, { title: string; description: string }> = {
  structure: { title: 'Cơ cấu', description: 'Cây đơn vị của công ty: khối, phòng ban, nhóm và người phụ trách.' },
  employees: { title: 'Nhân sự', description: 'Nhân viên, đơn vị, chức danh và quản lý trực tiếp — nhập tay hoặc từ Excel.' },
  positions: { title: 'Chức danh', description: 'Danh mục chức danh và cấp bậc dùng khi gán Goal Plan và bộ mẫu.' },
  company: { title: 'Công ty', description: 'Thông tin công ty dùng trên phiếu, báo cáo và file xuất.' },
};

/** "Tổ chức" — WBS 4.1.1–4.1.4 and 4.1.7 (Track T1); one sub-page per section. */
export default function OrgUnitsPage({ section }: { section: OrgSection }) {
  const { title, description } = SECTIONS[section];
  return (
    <>
      <PageHeader title={title} description={description} />
      {section === 'structure' ? <OrgStructureTab /> : section === 'employees' ? <EmployeesTab /> : section === 'positions' ? <PositionsTab /> : <TenantTab />}
    </>
  );
}
