# Quy trình KPI trên hệ thống Syntra KPI (P1)

> Tài liệu làm việc cho product owner và HR — **đề xuất**, sẽ được chốt dần qua các track của Phase 2
> và buổi UAT ở Phase 4. Quy tắc chính thức: `.agents/knowledge/business-rules.md` (mã `BR-KPI-xx`).
> Cách làm hiện tại: `current-flow.md`.

---

## 1. Vòng đời một chu kỳ KPI

```mermaid
flowchart LR
  A[HR tạo chu kỳ 2027<br/>12 kỳ tháng, 4 kỳ quý] --> B[Giao KPI công ty<br/>và bộ phận]
  B --> C[Quy trình 1<br/>Đăng ký KPI cá nhân]
  C --> D[HR khóa Goal Plan]
  D --> E[Nhập số thực tế hằng tháng<br/>tay · Excel · API]
  E --> F[Quy trình 3<br/>Đánh giá KPI tháng]
  F --> G[Kết quả: điểm có trọng số<br/>→ xếp loại → % lương]
  G --> H[Dashboard sống<br/>công ty · bộ phận · cá nhân<br/>mục 4F]
  D -. khi cần .-> X[Quy trình 2<br/>Điều chỉnh KPI]
  X -.-> D
```

Ba tầng mục tiêu: **Công ty → Bộ phận → Cá nhân**, nối với nhau bằng **cascade** (quản lý giao xuống
một phần chỉ tiêu của mình) và **link** (nhân viên tự thêm mục tiêu và liên kết lên mục tiêu của quản
lý). Mỗi Goal Plan có 3–5 KGI và 5–8 KPI, tổng trọng số 100%, mỗi KPI phải có nguồn số liệu.

**Trạng thái chu kỳ** chỉ đi tới từng bước: *Đang lập kế hoạch → Đang thực hiện → Đang đánh giá → Đã
đóng*. Tên, ngày và các kỳ của chu kỳ chỉ sửa được khi còn *Đang lập kế hoạch*; muốn chuyển sang *Đang
thực hiện* phải có ít nhất một kỳ hợp lệ. Đóng chu kỳ thì mọi kỳ bị khóa số liệu và Goal Plan của chu
kỳ không sửa được nữa.

## 1A. Thư viện KPI và bộ mẫu (track T2)

HR / C&B chuẩn bị thư viện **trước** khi lập Goal Plan, để mọi kế hoạch dùng cùng tên, đơn vị đo và cách tính:

```mermaid
flowchart LR
  A[Danh mục<br/>viễn cảnh BSC · đơn vị đo] --> B[Phương pháp tính<br/>tỷ lệ · bậc thang · đạt/không · công thức · định mức]
  B --> C[Chỉ tiêu mẫu<br/>mã, tên, viễn cảnh, đơn vị, phương pháp, nguồn số liệu]
  C --> D[Bộ mẫu<br/>theo đơn vị / chức danh / chung, trọng số mặc định]
  D --> E[Lập Goal Plan<br/>chọn chỉ tiêu hoặc áp bộ mẫu — T3]
  C -. Xuất Excel .-> F[File thư viện]
```

- **Viễn cảnh BSC** có đúng bốn, cố định: chỉ đổi tên hiển thị và thứ tự.
- **Chỉ tiêu mẫu** ở trạng thái *Nháp* được để trống nguồn dữ liệu; muốn *Đang áp dụng* thì phải có nguồn
  (KPI phải đo được). Chỉ chỉ tiêu *Đang áp dụng* mới chọn được khi lập Goal Plan hoặc bộ mẫu.
- **Lưu trữ** chỉ ẩn chỉ tiêu khỏi danh sách chọn, không xóa và không ảnh hưởng mục tiêu đã giao. Chỉ tiêu
  đang nằm trong một bộ mẫu *Đang áp dụng* thì phải gỡ khỏi bộ mẫu trước.
- **Chỉ tiêu chuẩn** (từ thư viện mẫu) sửa được như chỉ tiêu tự tạo, trừ mã.
- **Phương pháp tính đã dùng cho mục tiêu** giữ nguyên cách tính (loại, trần, sàn, công thức, bậc) — đổi
  sẽ làm điểm các kỳ đang mở thay đổi âm thầm. Muốn tính khác thì tạo phương pháp mới.
- **Bộ mẫu**: tổng trọng số 100% và 5–8 chỉ tiêu là **khuyến nghị**, màn hình cảnh báo nhưng vẫn cho lưu;
  Goal Plan lập từ bộ mẫu mới là thứ phải đủ 100% và 5–8 chỉ tiêu để gửi duyệt.
- **Xuất Excel** cả thư viện, bộ mẫu và danh mục mã. **Nhập từ Excel** sẽ có khi khung import chung (T4) xong.

## 2. Quy trình 1 — Đăng ký KPI (GOAL_SETTING)

Theo email template hiện tại, giữ nguyên 4 bước nhưng chạy trên hệ thống:

```mermaid
sequenceDiagram
  participant HR as HR / C&B
  participant QL as Quản lý trực tiếp
  participant NV as Nhân viên
  HR->>QL: Khởi chạy phiếu đăng ký (thông báo in-app)
  QL->>NV: B1. Phân giao chỉ tiêu từ KPI của mình (cascade)
  NV->>QL: B2. Thêm mục tiêu, liên kết lên KPI quản lý, đủ 100% → Gửi
  alt Cần sửa
    QL-->>NV: B3. Trả lại (kèm nhận xét)
    NV->>QL: Sửa và gửi lại
  else Đồng ý
    QL->>HR: B3. Duyệt (hoặc chỉnh sửa rồi duyệt)
  end
  HR->>HR: B4. Ghi nhận và khóa Goal Plan
  Note over QL,NV: Quá hạn bước nào → khóa / nhắc theo cấu hình của bước
```

- Nút **Gửi** chỉ bật khi tổng trọng số đạt 100% (sai số ±0,01) và có 5–8 chỉ tiêu; nếu chưa đạt, hệ
  thống nói rõ còn thiếu gì.
- Quản lý thấy với mỗi KPI đã cascade: **đã giao cho NV / tự nhận / chưa giao / tự thực hiện**; phần
  "chưa giao" do hệ thống tính.
- Goal Plan của **công ty / bộ phận** được HR khởi tạo phiếu đăng ký bằng tay, người được đăng ký là
  trưởng đơn vị; mỗi Goal Plan chỉ có một phiếu đăng ký đang mở. Nút **Bắt đầu đăng ký** nằm trên từng
  dòng ở *Quản trị KPI › Chu kỳ › Goal Plan* (cột "Phiếu đăng ký" ghi "Chưa bắt đầu", hoặc "Chưa có trưởng
  đơn vị" khi chưa bắt đầu được). Hộp thoại cho thấy ai xử lý từng bước lúc này và hạn xử lý (mặc định
  bằng tổng thời hạn các bước, 11 ngày). Với quy trình 4 bước mặc định, phiếu của một phòng tới **giám
  đốc khối trước** (bước 1, giao chỉ tiêu), rồi tới **trưởng phòng** ở bước 2. Phiếu của công ty không có
  người nhận ở bước 1 và 3 (Tổng giám đốc không có quản lý trực tiếp): HR thao tác thay, và cần làm kịp vì
  quá hạn bước 1 thì Goal Plan tự khóa.
- **Phân giao từ công ty xuống bộ phận.** Trên Goal Plan công ty (hoặc của một khối), "Phân giao" cho chọn
  **Giao cho: Đơn vị | Nhân viên**. "Đơn vị" liệt kê Goal Plan của các đơn vị cấp dưới **gần nhất** có
  Goal Plan trong chu kỳ: khối chưa có Goal Plan thì đi thẳng xuống các phòng. Chỉ tiêu giao xuống thuộc
  trưởng đơn vị; "Đã giao / Tự giao / Chưa giao" tính như khi giao cho nhân viên.
- **Ai giao được vào Goal Plan của một phòng**: khi chưa có phiếu đăng ký — trưởng phòng hoặc HR (Goal Plan
  *Nháp*); khi phiếu đang chạy — người xử lý bước hiện tại, hoặc HR thao tác thay họ (được ghi cả hai
  người). Tổng giám đốc không giao trực tiếp được vào Goal Plan phòng. Thứ tự HR nên làm cho chu kỳ mới:
  lập Goal Plan công ty → tạo Goal Plan các phòng → phân giao → bắt đầu đăng ký từng phòng.
- Hết hạn ở một bước → hệ thống **khóa Goal Plan**, phiếu đứng yên ở bước đó. HR mở khóa phải ghi lý do
  và hạn mới; bước được tính lại từ lúc mở khóa nên lần chạy sau không khóa lại ngay.
- HR hủy phiếu đăng ký (kể cả khi đang bị khóa) thì Goal Plan về *Nháp*; việc mở khóa này được ghi
  lịch sử kèm lý do hủy.

## 3. Quy trình 2 — Điều chỉnh KPI (GOAL_CHANGE)

Goal Plan đã khóa chỉ thay đổi được qua phiếu điều chỉnh: người đề xuất → quản lý trực tiếp duyệt → HR
ghi nhận và khóa lại. Chỉ tiêu bị đổi hoặc hủy giữ lịch sử (Đang áp dụng → Đã thay đổi / Đã hủy).

- HR (hoặc quản lý) khởi tạo phiếu điều chỉnh bằng tay (không qua đợt khởi chạy) cho Goal Plan **đã
  khóa**; mỗi Goal Plan chỉ có **một** phiếu điều chỉnh đang mở. Người lập lưu nháp đề xuất được khi
  chưa ghi lý do, nhưng **gửi** thì mọi dòng phải có lý do.
- Phiếu ghi **danh sách đề xuất**: thêm / sửa / hủy chỉ tiêu, mỗi dòng kèm lý do. Trong lúc phiếu đang
  chạy, Goal Plan **vẫn khóa** và số liệu, đánh giá vẫn tính theo chỉ tiêu cũ.
- Chỉ khi bước cuối duyệt, hệ thống mới áp dụng: chỉ tiêu sửa sinh bản mới (bản cũ chuyển "Đã thay đổi"
  và vẫn tra lại được), chỉ tiêu hủy chuyển "Đã hủy".

## 4. Quy trình 3 — Đánh giá KPI tháng (KPI_EVAL)

```mermaid
sequenceDiagram
  participant SYS as Hệ thống
  participant NV as Nhân viên
  participant QL as Quản lý trực tiếp
  participant HR as HR / C&B
  SYS->>NV: Tự khởi chạy ngày 1 hằng tháng, hạn 7 ngày
  NV->>QL: B1. Tự đánh giá % từng chỉ tiêu + giải trình + bằng chứng
  Note over NV,QL: Quá hạn → phiếu tự chuyển sang quản lý (SF4C PMGM.09)
  QL->>HR: B2. Chấm % và nhận xét
  QL-->>NV: (hoặc trả lại B1)
  HR->>SYS: B3. Chốt % cuối cùng
  SYS->>SYS: Tính điểm có trọng số → xếp loại → % lương
```

- Số **thực tế** trên phiếu lấy từ dữ liệu đã nhập (tay, Excel, API) và **chỉ đọc**.
- Phiếu chỉ gửi được khi mọi chỉ tiêu ở bước hiện tại đã có điểm (và nhận xét nếu bắt buộc).
- Quá hạn chỉ xử lý **một lần mỗi bước**: nhắc hạn không lặp lại liên tục. Nếu bước được cấu hình
  **khóa** khi quá hạn, phiếu dừng tại bước đó; HR mở khóa Goal Plan phải nhập **hạn mới**, bước chạy lại
  từ lúc mở khóa.
- Thao tác thay (HR làm thay) và ủy quyền đều ghi nhận **cả hai người**.
- Đợt đánh giá tháng tự khởi chạy ngày 1 tháng sau (một lần cho mỗi kỳ), kể cả khi chu kỳ đã sang
  *Đang đánh giá* (tháng 12). HR cũng có thể khởi chạy *ngay* hoặc *hẹn ngày*; đợt hẹn ngày chỉ hủy
  được khi chưa chạy.
- Số thực tế trên phiếu là **ảnh chụp lúc khởi chạy**, không sửa trên phiếu.
- Nhắc hạn gửi trước hạn bước **theo cấu hình của bước** ("Nhắc trước … ngày", mẫu hiện tại: 1 ngày);
  hệ thống có thể nhắc lại ở mỗi lần chạy nhưng mỗi người chỉ nhận **một** thông báo cho mỗi lần vào bước.
  Ai nhận thông báo gì: mục 4D.

## 4A. Ai thấy gì, ai làm gì (Phase 1.3)

- **Quyền khác với lượt xử lý.** Quyền (`business-rules.md` §9) quyết định một người được *mở* màn hình nào và
  *xem* dữ liệu của ai. Còn ai được gửi, duyệt hay trả lại một phiếu thì do **người xử lý của bước** quyết định
  (BR-KPI-20), không phải do quyền. Vì vậy không có quyền "duyệt KPI".
- **Mỗi người nhận đủ quyền của mọi vai trò mình có.** Ai có hồ sơ nhân viên đều có vai trò Nhân viên, nên
  ai cũng có mục "Của tôi". Quản lý có thêm "Đội nhóm" và "Điều hành", HR và C&B có "Quản trị KPI", Quản trị
  hệ thống thấy tất cả.
- **Phạm vi dữ liệu:**
  - Nhân viên: của bản thân.
  - Quản lý: đơn vị mình phụ trách và các đơn vị con.
  - HR, C&B, Ban điều hành, Quản trị hệ thống: toàn công ty.
  - KPI công ty: mọi người đều xem được, vì cascade bắt đầu từ đó.
- **Nhập URL trực tiếp không vượt quyền được.** Trang ngoài quyền hiện thông báo "Bạn không có quyền thực
  hiện thao tác này" và nút về trang chủ.
- **Chạy thử nhiều vai trò không cần đăng nhập lại.** Thanh trên cùng có ô chọn **công ty** và ô chọn **người
  dùng** (nhóm theo vai trò, tìm theo tên, đơn vị, vai trò). Đổi công ty thì không còn thấy dữ liệu của công
  ty kia.
- **Ủy quyền**: không ủy quyền cho chính mình, không ủy quyền tiếp (người đang được ủy quyền không ủy
  quyền lại; người đang ủy quyền cho người khác không nhận thêm ủy quyền trùng thời gian), không tạo hai
  ủy quyền trùng người, trùng loại phiếu, trùng thời gian. Người ủy quyền hoặc HR thu hồi; quản lý cấp
  trên của người ủy quyền thì không.
- Người được ủy quyền / HR làm thay khi **lưu nháp** cũng được ghi cả hai người, như khi gửi/duyệt.

## 4B. Kết quả kỳ (Gate 1)

Sau khi phiếu đánh giá hoàn thành:

1. **Tính kết quả (C&B/HR).** Hệ thống tính bản nháp ("Tạm tính") cho mọi Goal Plan đã duyệt/khóa
   của kỳ. Cá nhân: lấy % HR chốt (cột cuối) trên phiếu đánh giá đã hoàn thành — chưa hoàn thành phiếu
   thì chưa có kết quả (giả định Q17). Công ty / phòng ban: tính từ số liệu thực tế. Tính lại bao nhiêu
   lần cũng được khi còn là bản nháp; kết quả đã chốt không bị tính lại.
2. **Điều chỉnh (C&B/HR).** Cộng/trừ điểm (vi phạm, chuyên cần) trên bản nháp; xếp loại và % lương
   KPI cập nhật ngay, kể cả khi điều chỉnh làm đổi loại.
3. **Chốt kết quả (C&B/HR).** Chốt một số hoặc toàn bộ bản nháp của kỳ. Điểm được làm tròn 2 chữ số
   một lần. Chỉ cần MỘT kết quả còn vướng (tổng trọng số ≠ 100%, chỉ tiêu chưa có điểm hoặc không tính
   được) thì không kết quả nào được chốt, và màn hình liệt kê mọi chỗ vướng.
4. **Khóa kết quả (C&B/HR).** Kết quả đã chốt được khóa, không sửa được nữa; bản nháp giữ nguyên. Khóa
   kết quả không khóa kỳ nhập số liệu.
5. **Xuất file lương (C&B).** C&B xuất file Excel gồm kết quả cá nhân **đã chốt hoặc đã khóa** của kỳ
   (giả định Q38): mã NV, họ tên, đơn vị, chức danh, điểm KPI (đã gồm điều chỉnh), điều chỉnh điểm, xếp
   loại, % hưởng lương KPI. Bản tạm tính và kết quả phòng ban/công ty không có trong file. Kết quả chưa có
   % hưởng lương KPI vẫn có trong file, cột % để trống kèm ghi chú (giả định Q39). Xuất file không đổi
   trạng thái kết quả; xuất lại bao nhiêu lần cũng được, mỗi lần một file trong lịch sử xuất file.
6. Khi kết quả của kỳ đã chốt, không nhập thêm số thực tế cho Goal Plan đó trong kỳ đó.
7. **Nhân viên xem "Kết quả của tôi"** sau khi HR chốt. Bản tạm tính hiện "Đang tổng hợp", không có số.

## 4C. Tổ chức và nhân sự (Track T1)

Quản trị hệ thống làm phần này một lần trước khi giao KPI, rồi cập nhật khi có thay đổi nhân sự. Màn hình:
**Hệ thống → Tổ chức** (Cơ cấu · Nhân sự · Chức danh · Công ty) và **Hệ thống → Người dùng & quyền**
(Tài khoản · Vai trò & quyền). Quy tắc chi tiết: `business-rules.md` §10.

- **Cây tổ chức.** Công ty → Khối → Phòng ban → Nhóm (được bỏ qua một cấp). Không ngừng dùng được đơn vị
  còn đơn vị trực thuộc đang dùng, còn nhân viên, hoặc còn bảng mục tiêu của chu kỳ chưa đóng; màn hình
  ghi rõ lý do bên cạnh nút.
- **Điều chuyển.** Thêm phân công chính mới từ ngày D thì phân công đang có tự kết thúc ngày D − 1, trong
  cùng một lần lưu. Từ ngày D, các bước "quản lý trực tiếp" trên phiếu đang mở chuyển cho quản lý mới
  (vì người xử lý được xác định lúc thao tác). Kiêm nhiệm không làm kết thúc phân công nào.
- **Nghỉ việc.** Nhập ngày làm việc cuối: tài khoản đăng nhập chuyển sang Ngừng dùng trước, rồi mới ghi
  nhận nghỉ việc (các phân công kết thúc vào ngày đó). Cấp dưới trực tiếp, đơn vị đang làm trưởng và ủy
  quyền **không tự đổi**: màn hình liệt kê để quản trị chỉ định người thay. Phiếu đang mở vẫn chạy tiếp.
- **Tài khoản.** Mỗi nhân viên có tối đa một tài khoản đang dùng; tài khoản của nhân viên luôn có vai trò
  Nhân viên (bản thân). Khi gán vai trò, màn hình cho biết phạm vi đó gồm bao nhiêu nhân viên.
- **Không tự khóa mình.** Hệ thống từ chối mọi thay đổi làm công ty không còn quản trị viên, làm vai trò
  Quản trị hệ thống mất quyền quản lý tổ chức/người dùng, hoặc làm chính người đang thao tác mất quyền
  quản lý người dùng.
- **Công ty.** Chỉ sửa tên, mã, múi giờ của công ty đang chọn. Chưa có tạo công ty mới hay tạm ngưng.
- **Nhập từ Excel (WBS 4.1.7).** Đã có file mẫu (sheet Nhân sự + mã đơn vị + mã chức danh) và quy tắc
  kiểm tra từng dòng. Nút "Nhập từ file" mở khi khung nhập dữ liệu dùng chung (T4) hoàn tất.

## 4D. Thông báo và nhật ký (Track T7)

Thông báo hiện trên **chuông** ở thanh trên cùng; bấm vào một thông báo thì mở màn hình liên quan và
thông báo được đánh dấu đã đọc. Giai đoạn này **chỉ gửi trong ứng dụng**, chưa gửi email.

| Khi nào | Ai nhận | Thông báo |
|---|---|---|
| Một đợt khởi chạy tạo phiếu | Người được đánh giá | Khởi chạy phiếu (quy trình mấy bước, đang ở bước nào, hạn) |
| Như trên, khi bước 1 không phải của người được đánh giá (đăng ký: bước 1 là quản lý) | Người xử lý bước 1 | Có phiếu cần xử lý |
| Phiếu chuyển sang bước tiếp theo (gửi, duyệt, hoặc tự chuyển do quá hạn) | Người xử lý bước mới | Có phiếu cần xử lý |
| Phiếu bị trả lại | Người nhận lại phiếu | Phiếu bị trả lại (ai trả, lý do) |
| HR mở khóa Goal Plan và đặt hạn mới | Người đang giữ phiếu | Có phiếu cần xử lý (hạn mới) |
| Trước hạn bước, theo lịch nhắc của bước | Người đang giữ phiếu | Nhắc hạn (và điều xảy ra khi quá hạn: khóa Goal Plan / tự chuyển bước) |

- Người được ủy quyền nhận thông báo **cùng** người ủy quyền.
- **Không ai nhận thông báo về thao tác của chính mình**, kể cả khi HR làm thay hay người được ủy quyền
  làm thay.
- Không có thông báo khi phiếu hoàn thành, bị hủy, hoặc khi bước đã quá hạn (giả định Q29): lời nhắc
  trước hạn đã nói điều gì sẽ xảy ra.
- Nội dung lấy từ **Mẫu thông báo** (Hệ thống → Mẫu thông báo); sự kiện nào thiếu mẫu thì không gửi.
- **Nhật ký** (Hệ thống → Nhật ký) ghi mọi thay đổi dữ liệu: ai làm, làm thay ai, lúc nào, trước/sau và
  lý do (khóa, mở khóa, hủy phiếu). Hiện chỉ Quản trị hệ thống xem được.
- Tệp đính kèm (bằng chứng, file import) tối đa 10 MB, chỉ nhận PDF, ảnh, Word, Excel, CSV, văn bản
  (giả định Q30).

## 4E. Số liệu thực hiện hằng tháng (Track T4)

Sau khi tháng kết thúc (ngày 1 tháng sau), số thực tế của từng chỉ tiêu được ghi vào hệ thống theo ba
đường. Màn hình "Số liệu & import" mở sẵn tháng vừa kết thúc.

```mermaid
flowchart LR
  ERP[ERP Sale<br/>kết nối API] -- HR bấm Chạy đồng bộ --> S{Kiểm tra<br/>từng chỉ tiêu}
  X[Tệp Excel<br/>theo mẫu] -- HR tải lên --> P[Xem trước<br/>lỗi từng dòng] -- Ghi nhận cả lô --> S
  M[Nhập tay<br/>QL / HR / C&B] --> S
  S -- hợp lệ --> A[Số thực tế hiện tại<br/>+ lịch sử]
  A --> F[Phiếu đánh giá<br/>chụp số lúc khởi chạy]
```

1. **Nhập tay.** Quản lý (đơn vị của mình), HR, C&B nhập số cho từng chỉ tiêu; nhân viên không nhập số
   (giả định Q33) mà tự đánh giá kèm bằng chứng trên phiếu.
2. **Nhập từ Excel.** HR tải mẫu đã điền sẵn chỉ tiêu của tháng, điền số, tải lên. Tệp sai mẫu bị chặn
   ngay, không tạo lô. Tệp đúng mẫu tạo một lô "Đang kiểm tra" với lỗi từng dòng; còn một dòng lỗi thì
   không ghi nhận được, sửa tệp và tải lên thành lô mới. Ghi nhận là ghi cả lô hoặc không ghi gì.
3. **Đồng bộ API.** HR chạy đồng bộ cho một tháng. Số do người nhập (tay, Excel) không bị ghi đè
   (giả định Q37); số bị từ chối được ghi vào nhật ký lần chạy.
4. Mọi đường đều qua cùng một kiểm tra: kế hoạch đã duyệt/khóa (Q35), kỳ chưa khóa, kết quả chưa chốt,
   chỉ tiêu còn hiệu lực, **chỉ nhập theo tháng** (quý, năm tự cộng từ các tháng — Q36), kỳ đã bắt đầu,
   đúng kiểu số/chữ. Số mới thay số hiện tại, số cũ vẫn giữ trong lịch sử.
5. **Bằng chứng** (tệp hoặc đường dẫn) gắn vào chỉ tiêu theo tháng; link trong tệp Excel thành bằng chứng
   của số vừa ghi.

## 4F. Dashboard sống và trợ lý (Phase 3)

Mở **Điều hành → Dashboard**. Ai thấy gì do quyền "Xem dashboard" và phạm vi của họ quyết định
(`business-rules.md` §11):

| Người xem | Bắt đầu ở | Thấy |
|---|---|---|
| Ban điều hành, HR, Quản trị hệ thống | Công ty | Mọi khối, phòng ban và nhân viên |
| Quản lý (vd. trưởng phòng Kinh doanh) | Đơn vị mình phụ trách | Đơn vị mình, đơn vị trực thuộc và nhân viên trong đó — không thấy công ty hay khối phía trên |
| Nhân viên | — (không có dashboard) | Phần "KPI của tôi" ở **Kết quả của tôi**: điểm, xếp loại, % hưởng lương KPI của kỳ đã chốt gần nhất, chênh lệch với kỳ trước và chỉ tiêu cần chú ý |

```mermaid
flowchart LR
  C[Công ty<br/>điểm kế hoạch công ty] --> K[Khối<br/>chưa có kế hoạch riêng:<br/>điểm trung bình nhân viên]
  K --> P[Phòng ban<br/>điểm kế hoạch phòng]
  P --> N[Nhân viên<br/>chi tiết từng chỉ tiêu]
```

- **Tổng quan.** Chọn chu kỳ và kỳ; mặc định là tháng gần nhất đã có kết quả chốt. Mỗi đơn vị hiện điểm
  của chính kế hoạch đơn vị (đúng số đã lưu, không tính lại), xếp loại, chênh lệch với kỳ trước, số nhân
  viên đã có kết quả chốt và điểm trung bình nhân viên (không trọng số, chỉ kết quả đã chốt — giả định
  Q40). Khối không có kế hoạch riêng thì ghi "Chưa có kế hoạch". Bấm tên đơn vị để đi xuống; bấm tên
  nhân viên để xem từng chỉ tiêu.
- **Tạm tính.** Kết quả chưa chốt hiện nhãn "Tạm tính" và không vào các con số thống kê chính thức.
- **Cần chú ý.** Chỉ tiêu dưới 90% hoàn thành là "Dưới ngưỡng"; chưa có số là "Thiếu số liệu" (không
  bao giờ tính là 0); kết quả ở hai mức xếp loại thấp nhất là "Xếp loại thấp" (giả định Q41).
- **Nhân viên chuyển đơn vị hoặc nghỉ việc** được tính ở đơn vị họ thuộc vào ngày cuối kỳ (giả định Q43).
- **Vận hành.** Tiến độ đăng ký KPI của chu kỳ, phiếu đánh giá của kỳ theo trạng thái và theo bước,
  kết quả kỳ theo trạng thái và xếp loại, danh sách phiếu quá hạn (cùng cách tính với màn hình Duyệt &
  đánh giá). Nút "Xuất báo cáo vận hành (Excel)" — khác với file lương của C&B.
- **Trợ lý KPI (giả lập).** Tóm tắt đơn vị đang xem và trả lời khoảng 5 loại câu hỏi (điểm, cao nhất /
  thấp nhất, so với kỳ trước, chỉ tiêu cần chú ý, phiếu quá hạn) — chỉ từ số liệu đang hiển thị trong
  phạm vi người xem. Không phải đánh giá chính thức; không ảnh hưởng điểm.

## 5. Khác biệt so với hiện tại

| # | Hiện tại (`current-flow.md`) | Trên hệ thống | Lý do | Quy tắc |
|---|---|---|---|---|
| 1 | Công thức trong ô Excel, mỗi file một kiểu | Phương pháp tính chung trong thư viện, một chỗ, có kiểm thử | Hết `#REF!`, cùng chỉ tiêu cùng cách tính | BR-KPI-30…36 |
| 2 | Nhắc hạn bằng email tay | Thông báo in-app tự động khi khởi chạy và trước hạn | HR không phải theo dõi tay | BR-KPI-13, 19 |
| 3 | "Khóa sau hạn" chỉ là lời nhắc | Khóa thật, hoặc tự chuyển bước, theo cấu hình | Quy tắc có hiệu lực | BR-KPI-13, 14 |
| 4 | Không thấy phần chưa giao | Hệ thống tính "chưa giao" cho từng KPI cascade | Quản lý giao đủ, không giao vượt | BR-KPI-07 |
| 5 | Số liệu không nguồn, không bằng chứng | Mỗi KPI có nguồn; mỗi số ghi rõ tay / Excel / API; bằng chứng đính kèm | Kiểm chứng được khi chấm | BR-KPI-05, 52 |
| 6 | Tổng hợp cuối kỳ trong sheet TH KQ | Điểm, xếp loại, % hưởng lương KPI tính tự động; file lương xuất từ kết quả đã chốt; dashboard sống | Ban điều hành thấy ngay; C&B không chép số tay | BR-KPI-35, 40–46 |
| 7 | Phiếu đánh giá tháng gửi tay | Tự khởi chạy theo lịch (ngày 1 hằng tháng) | Không quên kỳ nào | BR-KPI-19 (D5) |
| 8 | Mỗi phòng tự gõ bộ KPI trong sheet riêng, tổng trọng số có bộ không đủ 100% | Thư viện chỉ tiêu mẫu và bộ mẫu dùng chung; trọng số lệch được cảnh báo | Cùng tên, cùng cách tính giữa các phòng | BR-KPI-74…80 |

## 6. Câu hỏi mở

Danh sách đầy đủ và giá trị mặc định đang dùng: plan §9 và `business-rules.md` §8. Những câu ảnh hưởng
trực tiếp đến quy trình:

| # | Câu hỏi | Mặc định | Người trả lời |
|---|---|---|---|
| Q3 | Đánh giá chính theo tháng hay quý? | Tháng | HR |
| Q7 | P1 có "Lấy ý kiến", "Thêm người duyệt", bước hợp tác không? | Không (để P2) | Product owner + HR |
| Q10 | "Kế hoạch công việc tháng" (PMGM.08) có thuộc P1 không? | Không | Product owner |
| — | Goal Plan có trạng thái "Bị trả lại" riêng không? (Plan có, ERD chưa có) | Có — chốt ở Phase 1.1 | System architect + HR |
| — | Bước nào khóa khi quá hạn, bước nào tự chuyển? | Đăng ký: khóa; đánh giá: tự chuyển | HR |
| Q12 | Danh mục quyền, quyền mặc định của từng vai trò và phạm vi dữ liệu? (Các tài liệu nguồn không nêu) | Như `business-rules.md` §9 | Product owner + HR |
| Q13 | % lương KPI có chia theo số ngày làm việc khi nhân viên vào hoặc nghỉ giữa kỳ? | Không chia | HR + C&B |
| Q17 | Nhân viên có kết quả kỳ khi chưa hoàn thành phiếu đánh giá không (ví dụ lấy từ số thực tế, hoặc cột quản lý)? | Không — chỉ lấy cột cuối của phiếu đánh giá đã hoàn thành | Product owner + HR / C&B |
| Q18 | Có nhập số thực tế cho kỳ chưa bắt đầu được không? | Không | Product owner + HR / C&B |
| Q19–Q24 | Quy tắc tổ chức, điều chuyển, nghỉ việc, quản lý ngoài đơn vị, quản lý công ty (các tài liệu nguồn không nêu) | Như `business-rules.md` §8 và §10 | Product owner + HR |
| Q25 | Chỉ tiêu mẫu có bắt buộc nguồn dữ liệu không? | Chỉ khi Đang áp dụng | HR |
| Q26 | Bộ mẫu có bắt buộc đủ 100% và 5–8 chỉ tiêu không? | Không — chỉ cảnh báo | HR |
| Q27 | Lưu trữ chỉ tiêu mẫu nghĩa là gì? | Ẩn khỏi danh sách chọn; không được khi còn trong bộ mẫu đang áp dụng | HR |
| Q28 | Công ty có sửa được chỉ tiêu chuẩn không? | Có, trừ mã | Product owner |
| Q29 | Có báo cho người giữ phiếu khi bước đã quá hạn (phiếu tự chuyển hoặc Goal Plan bị khóa) không? | Không — lời nhắc trước hạn đã nói trước | Product owner + HR |
| Q30 | Giới hạn dung lượng và định dạng tệp đính kèm? | 10 MB; PDF, ảnh, Word, Excel, CSV, văn bản | Product owner + HR |
| — | HR có được xem Nhật ký không? (Hiện chỉ Quản trị hệ thống) | Chưa — chỉ Quản trị hệ thống | Product owner |
| Q31 | Tỉ lệ đóng góp của liên kết (link) có dùng để tính điểm không? | Không — chỉ để tham khảo | HR |
| Q32 | Chu kỳ không bắt đầu từ tháng 1 thì "Q1" là tháng 1–3 hay 3 tháng đầu chu kỳ? | 3 tháng đầu chu kỳ | HR |
| Q33 | Ai nhập số thực tế bằng tay — nhân viên có nhập không? | Không: quản lý, HR, C&B nhập; nhân viên tự đánh giá kèm bằng chứng | Product owner + HR |
| Q35 | Có nhập số cho chỉ tiêu khi Goal Plan chưa duyệt/khóa không? | Không | Product owner + HR |
| Q36 | Quý, nửa năm, năm có số thực tế riêng không? | Không: chỉ nhập theo tháng, kỳ dài hơn tự cộng | HR |
| Q37 | Đồng bộ API có ghi đè số người đã nhập (tay, Excel) không? | Không: bỏ qua và ghi nhật ký | HR |
| Q38 | Kết quả nào được xuất sang lương, và xuất có khóa kết quả không? | Kết quả cá nhân đã chốt hoặc đã khóa; xuất không đổi trạng thái | Product owner + C&B |
| Q39 | Kết quả đã chốt nhưng chưa có % hưởng lương KPI (chưa có quy tắc, chưa xếp loại): chặn xuất hay vẫn xuất? | Vẫn xuất, cột % để trống kèm ghi chú | C&B |
| Q40 | Khối (không có kế hoạch riêng) hiện điểm gì? | "Chưa có kế hoạch" + điểm trung bình nhân viên đã chốt, không trọng số | Product owner + HR |
| Q41 | Khi nào chỉ tiêu / kết quả "cần chú ý"? | Chỉ tiêu dưới 90% hoàn thành; kết quả ở hai mức xếp loại thấp nhất | HR |
| Q42 | Dashboard so sánh với kỳ nào? | Kỳ liền trước cùng loại trong chu kỳ; thiếu số thì không so sánh | Product owner |
| Q43 | Nhân viên chuyển đơn vị / nghỉ việc tính ở đơn vị nào? | Đơn vị họ thuộc vào ngày cuối của từng kỳ | Product owner (đã chốt 19/10/2026) |

## 7. Quyết định đã chốt

*(Ghi ngày, quyết định và lý do khi từng điểm trên được chốt.)*

- **19/10/2026 — Chọn người dùng, không chọn vai trò.** Quyền của một người là tổng quyền mọi vai trò người đó
  có (BR-KPI-60). Bộ chuyển trên thanh trên chỉ đổi công ty và người dùng. *Lý do: một khái niệm ít hơn để giải
  thích khi demo, và giống hệ thống thật.*
- **19/10/2026 — Quản lý xem theo đơn vị phụ trách và các đơn vị con.** Phạm vi "cấp dưới trực tiếp" vẫn dùng
  được cho trưởng nhóm không phụ trách đơn vị.
- **19/10/2026 — Quản trị hệ thống có toàn bộ quyền** và thấy cả 5 nhóm menu. Đây là điểm khác plan §7.1.

**19/10/2026 — Phase 1.5, các quy tắc tính và quy trình (product owner duyệt).** Chi tiết: `business-rules.md`.

- **Không có điểm thì không phải 0%.** Chỉ tiêu chưa có số thực tế hoặc không tính được (mục tiêu = 0,
  không khớp bậc/định mức) được coi là chưa có điểm; còn chỉ tiêu như vậy thì HR không chốt được kết quả.
- **Trần bắt buộc** với các phương pháp tỷ lệ và công thức. Không đặt sàn thì sàn là 0%.
- **Định mức L1/L2/L3:** cần ít nhất 2 mức; giữa hai mức thì nội suy; vượt mức cao nhất thì lấy điểm mức
  cao nhất; chưa đạt L1 thì 0%.
- **Xếp loại** đọc điểm đã làm tròn 2 chữ số (89,995 → 90,00 → loại B).
- **Người nghỉ việc giữa kỳ** vẫn được đánh giá cho kỳ có làm việc; phần chỉ tiêu đã giao cho họ quay
  về "chưa giao"; % lương KPI không chia theo số ngày làm việc (giả định Q13).
- **Khóa khi quá hạn** chỉ dùng cho phiếu đăng ký. Không ai được duyệt phiếu của chính mình. HR được làm
  thay ở bước không có người xử lý, để phiếu không bị kẹt.

**19/10/2026 — Gate 1, luồng quy trình (product owner duyệt).**

- Chu kỳ chỉ đi tới từng bước; chỉ sửa chu kỳ và kỳ khi *Đang lập kế hoạch*; đóng chu kỳ khóa mọi kỳ.
- Đánh giá tự khởi chạy cả trong chu kỳ *Đang đánh giá*.
- Hệ thống không tự lọc nhắc hạn trùng; mỗi lần nhắc mang một khóa cố định để thông báo chỉ ghi một lần.

**19/10/2026 — Gate 1, kết quả kỳ (product owner duyệt).**

- Kết quả cá nhân chỉ lấy từ phiếu đánh giá đã hoàn thành (giả định Q17).
- Chốt kết quả theo nguyên tắc "tất cả hoặc không": còn một kết quả vướng thì không chốt kết quả nào.
- Phòng ban/công ty được xếp loại nhưng không có % lương.
- Kỳ đã chốt kết quả thì không nhập thêm số thực tế; chưa đến kỳ thì cũng chưa nhập được (giả định Q18).

**19/10/2026 — Track T1, tổ chức và phân quyền (product owner duyệt).** Chi tiết: `business-rules.md` §10.

- **Chỉ sửa công ty hiện tại**; không tạo công ty mới, không tạm ngưng trong bản thử nghiệm.
- **Ma trận quyền sửa được** theo từng vai trò, có bước xác nhận liệt kê quyền thêm/bỏ; vai trò Quản trị
  hệ thống luôn giữ quyền quản lý tổ chức và người dùng.
- **Nhập tổ chức từ Excel:** T1 làm file mẫu và quy tắc kiểm tra; việc nhập dùng khung chung của T4.
- **Quản lý trực tiếp ngoài đơn vị** được phép, có cảnh báo.
**19/10/2026 — Track T2, thư viện KPI (product owner duyệt).** Chi tiết: `business-rules.md` §3b.

- **Xuất Excel trước, nhập sau.** Nhập thư viện từ Excel sẽ dùng khung import chung của T4, không làm riêng.
- **Bộ mẫu chỉ cảnh báo** khi tổng trọng số khác 100% hoặc số chỉ tiêu ngoài 5–8; chỉ chặn việc thêm chỉ
  tiêu Nháp/Lưu trữ vào bộ mẫu.
- **Phương pháp tính đã dùng cho mục tiêu thì khóa cách tính**; tên, mô tả, mã vẫn sửa được.
**19/10/2026 — Track T7, thông báo và nhật ký (product owner duyệt theo khuyến nghị).**

- Không gửi thông báo khi bước đã quá hạn (giả định Q29); lời nhắc trước hạn nói rõ điều sẽ xảy ra.
- Tệp đính kèm tối đa 10 MB, chỉ các định dạng văn phòng, ảnh và văn bản (giả định Q30).
- Nhật ký giữ quyền xem như hiện tại (Quản trị hệ thống); việc mở cho HR chờ product owner chốt.
- Người được ủy quyền nhận thông báo cùng người ủy quyền.
**19/10/2026 — Track T3, kế hoạch mục tiêu (product owner duyệt).** Chi tiết: `business-rules.md` BR-KPI-05,
07, 08, 11, 26–28.

- **Kỳ tạo tự động**: 12 tháng (hạn nhập số ngày 5, hạn đánh giá ngày 13 tháng sau) và 4 quý; HR xem trước
  rồi mới áp dụng. Tạo lại không làm mất kỳ đã có.
- **Phân giao (cascade)**: quản lý giao một phần chỉ tiêu cho nhân viên khi phiếu đăng ký của nhân viên đang
  ở bước của quản lý (bước 1, hoặc bước duyệt). Hệ thống tạo chỉ tiêu trong Goal Plan của nhân viên, mục tiêu
  bằng phần giao; giao vượt mục tiêu thì báo ngay. Sau khi đã giao, hạ mục tiêu hay tăng "tự giao" của chỉ
  tiêu cha mà vượt phần đã giao thì không lưu được.
- **"Gửi" nằm trên trang Goal Plan**, cạnh danh sách "Cần xử lý trước khi gửi"; ở bước của quản lý nút là
  "Chuyển cho nhân viên". Duyệt / trả lại vẫn ở trang Duyệt & đánh giá.
- **Chỉ tiêu riêng tư**: chỉ chủ chỉ tiêu, quản lý các cấp của họ và HR / C&B / Ban điều hành xem được.
- **Phân bổ theo kỳ lệch mục tiêu chỉ cảnh báo**, không chặn lưu hay gửi — nhưng cảnh báo hiện cả trên
  Goal Plan và danh sách của quản lý / HR, vì số quý và năm cộng từ các tháng.
- **Import Goal Plan** (mẫu một chỉ tiêu một dòng): quy tắc kiểm tra đã có; màn hình tải file làm cùng khung
  import của track số liệu (T4).
**19/10/2026 — Track T4, số liệu thực hiện (product owner duyệt).**

- Nhân viên không nhập số thực tế; quản lý, HR, C&B nhập (giả định Q33).
- Chỉ nhập số cho chỉ tiêu của Goal Plan đã duyệt hoặc đã khóa (Q35); chỉ nhập theo tháng (Q36).
- Đồng bộ API không ghi đè số do người nhập (Q37); import Excel thì ghi đè, có cảnh báo trước khi ghi nhận.
- Import Excel ghi cả lô hoặc không ghi gì; tệp sửa lại được tải lên thành lô mới.
**19/10/2026 — Track T6, kết quả và file lương (product owner duyệt).**

- File lương lấy kết quả cá nhân đã chốt hoặc đã khóa; xuất file không khóa kết quả (giả định Q38).
- Kết quả chưa có % hưởng lương KPI vẫn có trong file, để trống kèm ghi chú (giả định Q39).
- Chỉ C&B (và quản trị hệ thống) xuất file lương; HR tính, điều chỉnh, chốt và khóa.
- Thang xếp loại mẫu chỉ xem, chưa sửa trên màn hình cho tới khi có câu trả lời Q2; quy tắc quy đổi thì
  sửa được để thử.
- Nhân viên chỉ thấy số của kết quả đã chốt.
**19/10/2026 — Phase 3, dashboard và trợ lý (product owner duyệt).** Chi tiết: `business-rules.md` §11.

- Dashboard một màn hình đi từ công ty xuống nhân viên; quản lý bắt đầu ở đơn vị mình. Nhân viên xem
  "KPI của tôi" trong Kết quả của tôi.
- Điểm hiển thị đúng như đã lưu; kết quả tạm tính có nhãn và không vào thống kê chính thức.
- Khối chưa có kế hoạch riêng: hiện điểm trung bình nhân viên (Q40); ngưỡng cần chú ý 90% và hai mức
  xếp loại thấp nhất (Q41); so với kỳ liền trước (Q42); người chuyển đơn vị tính theo từng kỳ (Q43).
- Trợ lý KPI là bản giả lập, chỉ đọc số liệu đang hiển thị trong phạm vi người xem.

**21/10/2026 — Tầng công ty → bộ phận trên màn hình (product owner duyệt).** Chi tiết: `business-rules.md`
BR-KPI-07, 19.

- HR bắt đầu đăng ký Goal Plan công ty / bộ phận ngay trên danh sách Goal Plan của chu kỳ; hộp thoại nêu
  người xử lý từng bước và hạn mặc định bằng tổng thời hạn các bước.
- Phân giao từ Goal Plan công ty / khối xuống Goal Plan của đơn vị cấp dưới gần nhất có kế hoạch.
- Quy trình mặc định không đổi: giám đốc khối nhận bước 1, trưởng phòng bước 2. Quy tắc ai được sửa
  không đổi; HR thao tác thay ở mọi bước.
