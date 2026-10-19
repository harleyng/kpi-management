import { PageHeader } from '@/components/shared/PageHeader';
import { PlaceholderPanel } from '@/components/shared/PlaceholderPanel';

/** Placeholder (Phase 0). Replaced by WP 4.4.2–4.4.6, 4.3.7, Track T4. */
export default function ActualsImportPage() {
  return (
    <>
      <PageHeader
        title="Số liệu & import"
        description="Nhập số thực tế thủ công, theo lô Excel hoặc qua kết nối API."
      />
      <PlaceholderPanel
        spec="WP 4.4.2–4.4.6, 4.3.7, Track T4 (import kế hoạch: Track T3)"
        items={[
          "Khung import Excel dùng chung: tải mẫu, kiểm tra từng dòng, xem trước, xác nhận theo lô",
          "Import số thực tế và import Goal Plan hàng loạt",
          "Lịch sử lô import và lỗi theo dòng",
          "Quản lý bằng chứng đính kèm",
        ]}
      />
    </>
  );
}
