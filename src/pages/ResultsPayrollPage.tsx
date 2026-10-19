import { PageHeader } from '@/components/shared/PageHeader';
import { PlaceholderPanel } from '@/components/shared/PlaceholderPanel';

/** Placeholder (Phase 0). Replaced by WP 4.6.1–4.6.4 · Track T6. */
export default function ResultsPayrollPage() {
  return (
    <>
      <PageHeader
        title="Kết quả & lương"
        description="Tổng hợp điểm, xếp loại, quy đổi % lương và chốt kết quả theo kỳ."
      />
      <PlaceholderPanel
        spec="WP 4.6.1–4.6.4 · Track T6"
        items={[
          "Engine % hoàn thành và điểm có trọng số (rule ở Phase 1.5)",
          "Thang xếp loại và bảng quy đổi % lương (giả định, chờ Q2)",
          "Chốt kết quả theo kỳ và điều chỉnh vi phạm/chuyên cần",
          "Xuất file lương",
        ]}
      />
    </>
  );
}
