import { CalcMethodsPanel } from '@/components/library/CalcMethodsPanel';
import { PerspectivesSection, UnitsSection } from '@/components/library/CataloguesSections';
import { KpiDefinitionsPanel } from '@/components/library/KpiDefinitionsPanel';
import { LibraryActions } from '@/components/library/LibraryExportButton';
import { PageHeader } from '@/components/shared/PageHeader';
import { useSession } from '@/contexts/useSession';

export type LibrarySection = 'definitions' | 'perspectives' | 'units' | 'calc-methods';

const SECTIONS: Record<LibrarySection, { title: string; description: string }> = {
  definitions: { title: 'Chỉ tiêu mẫu', description: 'Chỉ tiêu dùng chung khi lập Goal Plan: định nghĩa, công thức, nguồn số liệu và phương pháp tính.' },
  perspectives: { title: 'Viễn cảnh BSC', description: 'Bốn viễn cảnh là cố định. Có thể đổi tên hiển thị và thứ tự.' },
  units: { title: 'Đơn vị đo', description: 'Đơn vị đang được chỉ tiêu hoặc mục tiêu dùng thì giữ nguyên mã.' },
  'calc-methods': { title: 'Phương pháp tính', description: 'Cách quy đổi số thực tế thành % hoàn thành.' },
};

/** Thư viện KPI — WBS 4.2.1 (danh mục), 4.2.2 (phương pháp tính), 4.2.3 (chỉ tiêu mẫu), 4.2.5 (xuất Excel). Track T2; one sub-page per section. */
export default function KpiLibraryPage({ section }: { section: LibrarySection }) {
  const { can } = useSession();
  const canManage = can('library.manage');
  const { title, description } = SECTIONS[section];

  return (
    <>
      <PageHeader title={title} description={description} actions={<LibraryActions />} />
      {section === 'definitions' ? (
        <KpiDefinitionsPanel canManage={canManage} />
      ) : section === 'perspectives' ? (
        <PerspectivesSection canManage={canManage} />
      ) : section === 'units' ? (
        <UnitsSection canManage={canManage} />
      ) : (
        <CalcMethodsPanel canManage={canManage} />
      )}
    </>
  );
}
