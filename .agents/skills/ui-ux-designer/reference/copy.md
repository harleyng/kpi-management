# Interface copy — Vietnamese UI

> Adapted from impeccable's `clarify` and frontend-design's writing section. See `NOTICE.md`.
> Words are design content, not decoration: they exist to make the screen easier to understand and use.

## Principles

- **Write from the user's side, in their words.** HR says "khóa Goal Plan", "khởi chạy phiếu", "chốt
  kết quả" — not "update status", "create form instances". Use the glossary in
  `business-rules.md` §0; never vary a term for style.
- **Sentence case, plain verbs, no filler.** "Lưu nháp", not "LƯU NHÁP" or "Thực hiện lưu nháp".
- **An action keeps its name through the whole flow.** The button "Gửi duyệt" produces the toast "Đã gửi
  duyệt"; "Khóa Goal Plan" produces "Đã khóa Goal Plan". Never "Submit", "OK", "Có/Không" on a
  consequential button — name the action on both the dialog title and its confirm button.
- **One fact per element.** If the heading already says it, the description adds something new or goes.
- **Errors come from `errorCatalog.ts`**, and each entry answers: what failed, why (when known and
  useful), how to recover. Errors do not apologise, are never vague, and never show an internal code as
  the primary message (the ERR-KPI code is for logs and support, not the headline).
- **Empty is an invitation to act.** "Chưa có chỉ tiêu nào. Thêm từ thư viện hoặc tạo mới." — and
  distinguish first use, no results, filtered out, and no permission.
- **Blocked actions say why.** "Tổng trọng số đang là 95%. Cần đủ 100% để gửi." next to the disabled
  button, not only in a tooltip.
- **Loading names the real operation** when the wait matters ("Đang kiểm tra 120 dòng…"); never invent
  progress.
- **Destructive actions name the object and the consequence.** "Xóa chỉ tiêu 'Doanh thu' khỏi Goal Plan?
  Số thực tế đã nhập cho chỉ tiêu này cũng bị xóa."
- **Persistent labels.** Placeholders are examples, not labels; required fields are marked consistently.
- **Numbers and units** use `formatNumber` / `formatPercent` (vi-VN: 1.180; 85,5%); the unit sits in the
  column header, not repeated in every cell.

## Check before shipping copy

Could a first-time employee act on this screen without asking anyone? Is each term the glossary's term?
Does every error say how to recover? Is it as short as it can be without losing meaning or recovery?
