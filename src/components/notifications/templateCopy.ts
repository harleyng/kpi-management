import type { NotificationEvent } from '@/data/types';
import type { NotificationVariable, NotificationVars } from '@/lib/notificationRules';

/** What each `{{variable}}` stands for — shown on the insert chips of the template editor. */
export const VARIABLE_LABEL: Readonly<Record<NotificationVariable, string>> = {
  recipientName: 'Tên người nhận thông báo',
  subjectName: 'Tên người được đánh giá (chủ phiếu)',
  formType: 'Loại phiếu: Đăng ký, Điều chỉnh hoặc Đánh giá KPI',
  period: 'Kỳ của phiếu, ví dụ "tháng 03/2027"; phiếu đăng ký dùng tên chu kỳ',
  stepName: 'Tên bước hiện tại của phiếu',
  stepNo: 'Số thứ tự của bước hiện tại',
  stepCount: 'Tổng số bước của quy trình',
  dueDate: 'Hạn hoàn thành phiếu; với nhắc hạn là hạn của bước',
  actorName: 'Người vừa thao tác (gửi, duyệt, trả lại)',
  reason: 'Lý do trả lại phiếu',
  consequence: 'Điều xảy ra khi quá hạn bước (khóa Goal Plan, tự chuyển bước)',
  launchName: 'Tên đợt khởi chạy',
};

/** When the system sends each notice, and to whom (BR-KPI-45). */
export const EVENT_WHEN: Readonly<Record<NotificationEvent, string>> = {
  FORM_LAUNCHED: 'Gửi người được đánh giá khi một đợt khởi chạy tạo phiếu.',
  STEP_ASSIGNED: 'Gửi người phải xử lý khi phiếu chuyển đến bước của họ.',
  DEADLINE_REMIND: 'Gửi người đang giữ phiếu trước hạn bước, theo lịch nhắc hạn.',
  RETURNED: 'Gửi người nhận lại phiếu khi phiếu bị trả lại.',
};

/** Sample values for the preview — fictional, like the seed. */
export const PREVIEW_VARS: Readonly<Record<NotificationVariable, string | number>> = {
  recipientName: 'Nguyễn Văn An',
  subjectName: 'Nguyễn Văn An',
  formType: 'Đánh giá KPI',
  period: 'tháng 03/2027',
  stepName: 'Tự đánh giá',
  stepNo: 1,
  stepCount: 3,
  dueDate: '13/04/2027',
  actorName: 'Hoàng Ngọc Lan',
  reason: 'Cần bổ sung bằng chứng cho chỉ tiêu doanh thu',
  consequence: 'Quá hạn, phiếu sẽ tự chuyển sang bước tiếp theo.',
  launchName: 'Đánh giá KPI tháng 03/2027',
};

export const previewVars = (): NotificationVars => ({ ...PREVIEW_VARS });
