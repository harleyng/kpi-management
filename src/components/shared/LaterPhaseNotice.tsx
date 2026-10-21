import { InlineNotice } from './InlineNotice';

/**
 * Marks a screen kept in the prototype for a LATER phase (product owner, 21/10/2026): Phase 1 records
 * actuals by hand and by Excel import only — no API sync, no integration with other systems. The
 * screen still works on simulated data so the later flow can be shown.
 */
export function LaterPhaseNotice({ className }: { className?: string }) {
  return (
    <InlineNotice tone="info" title="Phase sau — chưa có trong P1" className={className}>
      P1 chỉ nhập số thực tế bằng tay và import Excel; chưa tích hợp API hay hệ thống khác. Màn này giữ lại để minh họa, dữ liệu là mô phỏng.
    </InlineNotice>
  );
}
