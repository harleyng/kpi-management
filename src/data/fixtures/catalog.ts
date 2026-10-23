import type {
  ActorRule,
  Aggregation,
  AllowedStepAction,
  BscPerspectiveCode,
  CalcMethodType,
  EvaluationColumn,
  FormType,
  KpiCategoryTag,
  LibraryStatus,
  NotificationChannel,
  NotificationEvent,
  OverdueBehaviour,
  SourceType,
  TargetType,
} from '@/data/types';

/**
 * The seed's catalogue DATA — library, templates, workflows, rating scale, notification texts —
 * as plain tables, shared by both tenants. `tenants/*.ts` turn it into rows.
 *
 * Library source: DATX workbook, sheet "2. KPIs phòng ban" (15 sets, 87 rows → 54 definitions after
 * de-duplication). Every correction made to the workbook is listed in `src/data/fixtures/README.md`
 * under "DATX cleaning" (`ASSUMPTION Q14`); each is marked `// Q14` here too.
 */

// ─── Library catalogues ────────────────────────────────────────────────────────────────────────

export const PERSPECTIVES: readonly { code: BscPerspectiveCode; name: string; sortOrder: number }[] = [
  { code: 'FIN', name: 'Tài chính', sortOrder: 1 },
  { code: 'CUS', name: 'Khách hàng', sortOrder: 2 },
  { code: 'PRO', name: 'Quy trình nội bộ', sortOrder: 3 },
  { code: 'LNG', name: 'Học hỏi & phát triển', sortOrder: 4 },
];

export const UNITS: readonly { code: string; name: string; decimals: number }[] = [
  { code: 'PCT', name: '%', decimals: 1 },
  { code: 'VND', name: 'đồng', decimals: 0 },
  { code: 'PERSON', name: 'người', decimals: 0 },
  { code: 'COUNT', name: 'số lượng', decimals: 0 },
  { code: 'TIMES', name: 'lần', decimals: 0 },
  { code: 'DAY', name: 'ngày', decimals: 1 },
  { code: 'MS', name: 'mili giây', decimals: 0 },
  { code: 'USER', name: 'người dùng', decimals: 0 },
  { code: 'RATIO', name: 'hệ số', decimals: 2 },
];

export interface CalcMethodSpec {
  code: string;
  name: string;
  methodType: CalcMethodType;
  capPct: number | null;
  floorPct: number | null;
  description: string;
  /** `[fromValue, toValue)` → achievement % (calcRules reads tiers half-open). */
  tiers?: readonly [number | null, number | null, number][];
}

/** The 120% cap and 0% floor are invented — DATX states no cap (BR-KPI-31). */
export const CALC_METHODS: readonly CalcMethodSpec[] = [
  { code: 'CM-UP', name: 'Càng cao càng tốt (trần 120%)', methodType: 'RATIO_UP', capPct: 120, floorPct: 0, description: '% thực tế / mục tiêu, tối đa 120%.' },
  { code: 'CM-DOWN', name: 'Càng thấp càng tốt (trần 120%)', methodType: 'RATIO_DOWN', capPct: 120, floorPct: 0, description: '% mục tiêu / thực tế, tối đa 120%.' },
  {
    code: 'CM-STOCKOUT',
    name: 'Bậc thang số lần đứt hàng',
    methodType: 'TIERED',
    capPct: null,
    floorPct: null,
    description: 'Không đứt hàng: 100%; 1 lần: 70%; 2 lần: 40%; từ 3 lần: 0% (DATX, Mua hàng).',
    tiers: [
      [0, 1, 100],
      [1, 2, 70],
      [2, 3, 40],
      [3, null, 0],
    ],
  },
  { code: 'CM-BINARY', name: 'Đạt / Không đạt', methodType: 'BINARY', capPct: null, floorPct: null, description: 'Đạt: 100%, không đạt: 0%.' },
  { code: 'CM-LEVELS', name: 'Định mức L1/L2/L3', methodType: 'LEVELS', capPct: null, floorPct: null, description: 'Theo định mức của từng chỉ tiêu được giao (nội suy tuyến tính, ASSUMPTION Q1).' },
];

/** Data sources. `invented` = not named by any source document (ASSUMPTION Q16). */
export const DATA_SOURCES: readonly { code: string; name: string; sourceType: SourceType; ownerUnit: string | null; invented: boolean }[] = [
  { code: 'ERP_SALE', name: 'ERP Sale', sourceType: 'API', ownerUnit: 'KH', invented: true },
  { code: 'ERP_KHO', name: 'ERP Kho vận', sourceType: 'EXCEL', ownerUnit: 'MH', invented: true },
  { code: 'CRM_CSKH', name: 'CRM Chăm sóc khách hàng', sourceType: 'EXCEL', ownerUnit: 'CSKH', invented: true },
  { code: 'HRIS', name: 'Phần mềm nhân sự (HRIS)', sourceType: 'EXCEL', ownerUnit: 'HCNS', invented: true },
  { code: 'SORAMA', name: 'Sorama (quản lý ngân sách quảng cáo)', sourceType: 'EXCEL', ownerUnit: 'MKT', invented: false },
  { code: 'MY_RESULT', name: 'My Result (quản lý công việc)', sourceType: 'EXCEL', ownerUnit: 'CN', invented: false },
  { code: 'MHTC', name: 'Mô hình tài chính (MHTC)', sourceType: 'EXCEL', ownerUnit: 'KT', invented: false },
  { code: 'CMS', name: 'CMS báo cáo kế toán', sourceType: 'MANUAL', ownerUnit: 'KT', invented: false },
  { code: 'MANUAL', name: 'Nhập tay', sourceType: 'MANUAL', ownerUnit: null, invented: true },
];

export interface KpiSpec {
  code: string;
  name: string;
  perspective: BscPerspectiveCode;
  unit: string;
  method: string;
  source: string;
  aggregation: Aggregation;
  tag: KpiCategoryTag | null;
  definition: string | null;
  formula: string | null;
  /** NUMERIC unless the KPI is a yes/no result. */
  targetType?: TargetType;
  status?: LibraryStatus;
}

/**
 * The library. Every KPI is monthly (`ASSUMPTION Q3`, Q15). Aggregation: SUM for money, counts and
 * volumes; AVG for ratios; LAST for headcount and stock levels (Q15). BSC perspective: where the
 * sheet gives only "Hiệu quả / Khối lượng / Chi phí", it is mapped by subject and the DATX word
 * kept as the tag (Q5, Q14).
 */
export const KPIS: readonly KpiSpec[] = [
  // Tài chính
  { code: 'KPI-DOANH-THU', name: 'Doanh thu', perspective: 'FIN', unit: 'VND', method: 'CM-UP', source: 'ERP_SALE', aggregation: 'SUM', tag: 'EFFICIENCY', definition: 'Doanh thu phát sinh trong tháng', formula: 'Tổng doanh thu ghi nhận trong kỳ' },
  { code: 'KPI-TSLN', name: 'Tỉ suất lợi nhuận', perspective: 'FIN', unit: 'PCT', method: 'CM-UP', source: 'MHTC', aggregation: 'AVG', tag: 'EFFICIENCY', definition: 'Lợi nhuận cuối cùng trên doanh thu thuần', formula: 'Lợi nhuận cuối cùng / doanh thu thuần × 100' }, // Q14: Kế toán's definition kept, Kế hoạch's "doanh thu / chi phí" dropped
  { code: 'KPI-LN-THUAN', name: 'Lợi nhuận thuần', perspective: 'FIN', unit: 'VND', method: 'CM-UP', source: 'MHTC', aggregation: 'SUM', tag: 'EFFICIENCY', definition: null, formula: null },
  { code: 'KPI-LAI-GOP', name: 'Lãi gộp', perspective: 'FIN', unit: 'VND', method: 'CM-UP', source: 'ERP_SALE', aggregation: 'SUM', tag: 'EFFICIENCY', definition: null, formula: null },
  { code: 'KPI-DT-SAN-PHAM', name: 'Doanh thu sản phẩm', perspective: 'FIN', unit: 'VND', method: 'CM-UP', source: 'ERP_SALE', aggregation: 'SUM', tag: 'EFFICIENCY', definition: null, formula: null },
  { code: 'KPI-CP-LUONG', name: 'Quản lý chi phí lương trong định mức', perspective: 'FIN', unit: 'PCT', method: 'CM-DOWN', source: 'MHTC', aggregation: 'AVG', tag: 'COST', definition: 'Chi phí lương trên tổng doanh thu, trong định mức của từng bộ phận', formula: 'Chi phí lương / doanh thu × 100' }, // Q14: CSKH tagged it "Hiệu quả"; every other set says "Chi phí"
  { code: 'KPI-CP-VAN-HANH', name: 'Quản lý chi phí vận hành trong định mức', perspective: 'FIN', unit: 'PCT', method: 'CM-DOWN', source: 'MHTC', aggregation: 'AVG', tag: 'COST', definition: null, formula: null }, // Q14: Kế toán's definition was a copy of the salary one — blanked, HR to confirm
  { code: 'KPI-CP-DONG-GOI', name: 'Chi phí đóng gói và vận chuyển nội bộ trên đơn hàng', perspective: 'FIN', unit: 'VND', method: 'CM-DOWN', source: 'ERP_KHO', aggregation: 'AVG', tag: 'COST', definition: 'Chi phí đóng gói và vận chuyển nội bộ / đơn hàng', formula: null }, // Q14: Vận hành had no method; cost per order is lower-is-better
  { code: 'KPI-CP-BU-SHIP', name: 'Chi phí bù ship trên đơn hàng', perspective: 'FIN', unit: 'VND', method: 'CM-DOWN', source: 'ERP_SALE', aggregation: 'AVG', tag: 'COST', definition: 'Chi phí bù ship / đơn hàng', formula: null }, // Q14
  { code: 'KPI-CP-MUA-HANG', name: 'Chi phí mua hàng và công nợ đến hạn', perspective: 'FIN', unit: 'VND', method: 'CM-DOWN', source: 'ERP_KHO', aggregation: 'SUM', tag: 'VOLUME', definition: 'Số tiền sử dụng mua hàng trong tháng', formula: null }, // Q14: Mua hàng row 1 split in two (this + stock-outs)
  { code: 'KPI-NGAN-SACH-QC', name: 'Ngân sách quảng cáo trên doanh thu', perspective: 'FIN', unit: 'PCT', method: 'CM-DOWN', source: 'SORAMA', aggregation: 'AVG', tag: 'EFFICIENCY', definition: 'Chi phí quảng cáo trên doanh thu (Sorama)', formula: 'Chi phí quảng cáo / doanh thu × 100' }, // Q14: no method in the sheet; spend over revenue is lower-is-better
  { code: 'KPI-DONG-TIEN', name: 'Kiểm soát dòng tiền theo kế hoạch', perspective: 'FIN', unit: 'VND', method: 'CM-UP', source: 'MHTC', aggregation: 'SUM', tag: 'EFFICIENCY', definition: 'Dòng tiền thuần so với kế hoạch', formula: null },
  { code: 'KPI-AOV', name: 'Giá trị đơn hàng trung bình (AOV)', perspective: 'FIN', unit: 'VND', method: 'CM-UP', source: 'ERP_SALE', aggregation: 'AVG', tag: 'EFFICIENCY', definition: 'Doanh thu / số đơn hàng', formula: null },
  { code: 'KPI-CR', name: 'Tỉ lệ chuyển đổi (CR)', perspective: 'FIN', unit: 'PCT', method: 'CM-UP', source: 'ERP_SALE', aggregation: 'AVG', tag: 'EFFICIENCY', definition: 'Số đơn hàng / số khách hàng tiếp cận', formula: null }, // Q14: Tư vấn "CR/AOV/HH" split in three
  { code: 'KPI-HOA-HONG', name: 'Tỉ lệ hoa hồng (HH)', perspective: 'FIN', unit: 'PCT', method: 'CM-UP', source: 'ERP_SALE', aggregation: 'AVG', tag: 'EFFICIENCY', definition: 'Hoa hồng trên doanh thu', formula: null }, // Q14: direction not stated — HR to confirm
  // Khách hàng
  { code: 'KPI-SO-KH', name: 'Số lượng khách hàng', perspective: 'CUS', unit: 'COUNT', method: 'CM-UP', source: 'ERP_SALE', aggregation: 'SUM', tag: 'VOLUME', definition: 'Tổng số khách hàng phát sinh doanh thu trong tháng', formula: null },
  { code: 'KPI-TL-KH-CU', name: 'Tỉ lệ khách hàng cũ', perspective: 'CUS', unit: 'PCT', method: 'CM-UP', source: 'ERP_SALE', aggregation: 'AVG', tag: null, definition: 'Khách hàng cũ phát sinh doanh thu trên tổng khách hàng trong tháng', formula: null }, // ASSUMPTION Q4: higher is better (the company set says "mục tiêu / thực tế")
  { code: 'KPI-SO-KH-CU', name: 'Số lượng khách hàng cũ', perspective: 'CUS', unit: 'COUNT', method: 'CM-UP', source: 'ERP_SALE', aggregation: 'SUM', tag: 'VOLUME', definition: null, formula: null }, // Q14: no method in the sheet
  { code: 'KPI-TL-HAI-LONG', name: 'Tỉ lệ khách hàng hài lòng (CS)', perspective: 'CUS', unit: 'PCT', method: 'CM-UP', source: 'CRM_CSKH', aggregation: 'AVG', tag: 'EFFICIENCY', definition: 'Số khách hàng hài lòng / số khách hàng mua hàng', formula: null },
  { code: 'KPI-TL-KHIEU-NAI', name: 'Tỉ lệ khiếu nại của khách hàng', perspective: 'CUS', unit: 'PCT', method: 'CM-DOWN', source: 'CRM_CSKH', aggregation: 'AVG', tag: 'EFFICIENCY', definition: 'Tổng số khiếu nại / tổng số khách hàng (hoặc đơn hàng)', formula: null },
  { code: 'KPI-TL-KH-SUCCESS', name: 'Tỉ lệ khách hàng sử dụng thành công', perspective: 'CUS', unit: 'PCT', method: 'CM-UP', source: 'CRM_CSKH', aggregation: 'AVG', tag: 'EFFICIENCY', definition: 'Tổng số khách hàng sử dụng thành công sản phẩm / tổng số đơn hàng', formula: null },
  { code: 'KPI-TL-KET-NOI', name: 'Tỉ lệ kết nối hai chiều', perspective: 'CUS', unit: 'PCT', method: 'CM-UP', source: 'CRM_CSKH', aggregation: 'AVG', tag: 'EFFICIENCY', definition: 'Số khách hàng kết nối hai chiều / số khách hàng mua hàng', formula: null },
  { code: 'KPI-TL-KN-CLSP', name: 'Tỉ lệ khiếu nại chất lượng sản phẩm', perspective: 'CUS', unit: 'PCT', method: 'CM-DOWN', source: 'CRM_CSKH', aggregation: 'AVG', tag: 'COST', definition: 'Tổng số khiếu nại về chất lượng sản phẩm / tổng số khách hàng (hoặc đơn hàng)', formula: null },
  // Quy trình nội bộ
  { code: 'KPI-TL-HOAN-HUY', name: 'Tỉ lệ hoàn hủy đơn hàng', perspective: 'PRO', unit: 'PCT', method: 'CM-DOWN', source: 'ERP_SALE', aggregation: 'AVG', tag: null, definition: null, formula: null }, // Q14: Vận hành had no method or tag
  { code: 'KPI-SP-MOI', name: 'Số sản phẩm mới phát triển thành công', perspective: 'PRO', unit: 'COUNT', method: 'CM-UP', source: 'MANUAL', aggregation: 'SUM', tag: 'VOLUME', definition: 'Sản phẩm đạt ngưỡng đơn hàng, tỉ suất lợi nhuận hạch toán > 15% và AOV theo ngành hàng', formula: null }, // Q14: thresholds kept as text, not as the target
  { code: 'KPI-SP-PHU-MOI', name: 'Số sản phẩm phủ mới', perspective: 'PRO', unit: 'COUNT', method: 'CM-UP', source: 'MANUAL', aggregation: 'SUM', tag: 'VOLUME', definition: null, formula: null },
  { code: 'KPI-DAU', name: 'Người dùng hoạt động hằng ngày (DAU)', perspective: 'PRO', unit: 'USER', method: 'CM-UP', source: 'MANUAL', aggregation: 'AVG', tag: 'EFFICIENCY', definition: 'Lượng người dùng tương tác hằng ngày', formula: null }, // Q14: Công nghệ wrote "mục tiêu / thực tế"; Sản phẩm's "thực tế / mục tiêu" kept
  { code: 'KPI-INFLUENCER', name: 'Phát triển influencer', perspective: 'PRO', unit: 'COUNT', method: 'CM-UP', source: 'MANUAL', aggregation: 'SUM', tag: 'VOLUME', definition: 'Influencer hoạt động: engagement ≥ 1%, CTR ≥ 20%', formula: null },
  { code: 'KPI-QMR', name: 'Tỉ lệ media đạt chất lượng (QMR)', perspective: 'PRO', unit: 'PCT', method: 'CM-UP', source: 'MANUAL', aggregation: 'AVG', tag: 'EFFICIENCY', definition: 'Số media đạt chất lượng / số media sản xuất', formula: null },
  { code: 'KPI-ORDER-DUNG-HAN', name: 'Hoàn thành order của các bộ phận đúng hạn', perspective: 'PRO', unit: 'PCT', method: 'CM-UP', source: 'MY_RESULT', aggregation: 'AVG', tag: 'VOLUME', definition: null, formula: null },
  { code: 'KPI-TON-KHO', name: 'Tồn kho', perspective: 'PRO', unit: 'VND', method: 'CM-UP', source: 'ERP_KHO', aggregation: 'LAST', tag: 'EFFICIENCY', definition: null, formula: null }, // Q14: direction kept as written — HR to confirm
  { code: 'KPI-XA-TON', name: 'Xả tồn', perspective: 'PRO', unit: 'VND', method: 'CM-DOWN', source: 'ERP_KHO', aggregation: 'SUM', tag: 'EFFICIENCY', definition: null, formula: null }, // Q14: direction kept as written — HR to confirm
  { code: 'KPI-LEAD-TIME', name: 'Thời gian nhập hàng (lead time)', perspective: 'PRO', unit: 'DAY', method: 'CM-DOWN', source: 'ERP_KHO', aggregation: 'AVG', tag: 'VOLUME', definition: null, formula: null }, // Q14: written "thực tế / mục tiêu"; a lead time is lower-is-better
  { code: 'KPI-DAM-BAO-HANG', name: 'Đảm bảo hàng hóa', perspective: 'PRO', unit: 'PCT', method: 'CM-UP', source: 'ERP_KHO', aggregation: 'AVG', tag: 'EFFICIENCY', definition: null, formula: null },
  { code: 'KPI-DUT-HANG', name: 'Số lần đứt hàng', perspective: 'PRO', unit: 'TIMES', method: 'CM-STOCKOUT', source: 'ERP_KHO', aggregation: 'SUM', tag: 'VOLUME', definition: '1 lần đứt hàng: 70%; 2 lần: 40%; từ 3 lần: 0%', formula: null }, // Q14: the one real TIERED rule in the workbook
  { code: 'KPI-LEAD', name: 'Số lead', perspective: 'PRO', unit: 'COUNT', method: 'CM-UP', source: 'ERP_SALE', aggregation: 'SUM', tag: 'VOLUME', definition: null, formula: null },
  { code: 'KPI-TINH-NANG', name: 'Hoàn thiện tính năng / sản phẩm', perspective: 'PRO', unit: 'COUNT', method: 'CM-UP', source: 'MY_RESULT', aggregation: 'SUM', tag: 'VOLUME', definition: 'Số lượng tính năng được nghiệm thu trong tháng', formula: null },
  { code: 'KPI-MY-RESULT', name: 'Tỉ lệ nhân viên sử dụng My Result hằng ngày', perspective: 'PRO', unit: 'PCT', method: 'CM-UP', source: 'MY_RESULT', aggregation: 'AVG', tag: 'EFFICIENCY', definition: 'Đưa hệ thống công việc lên phần mềm My Result', formula: null },
  { code: 'KPI-LOI-LON', name: 'Không phát sinh lỗi lớn', perspective: 'PRO', unit: 'COUNT', method: 'CM-BINARY', source: 'MANUAL', aggregation: 'LAST', tag: 'EFFICIENCY', definition: 'Đạt khi trong tháng không có lỗi ảnh hưởng từ 10 người dùng trở lên', formula: null, targetType: 'TEXT' }, // Q14: target 0 errors cannot be a ratio — recorded as Đạt / Không đạt
  { code: 'KPI-HIEU-NANG', name: 'Thời gian phản hồi (hiệu năng)', perspective: 'PRO', unit: 'MS', method: 'CM-DOWN', source: 'MANUAL', aggregation: 'AVG', tag: 'VOLUME', definition: 'Thời gian từ lúc bấm đến khi sử dụng được', formula: null }, // Q14: written "thực tế / mục tiêu"; a response time is lower-is-better
  { code: 'KPI-HT-KPI-BP', name: '% hoàn thành KPI của các bộ phận', perspective: 'PRO', unit: 'PCT', method: 'CM-UP', source: 'MANUAL', aggregation: 'AVG', tag: 'EFFICIENCY', definition: 'Trung bình hoàn thành KPI của các bộ phận', formula: null }, // ASSUMPTION Q8: measured on its own, not rolled up
  { code: 'KPI-BCTC-DUNG-HAN', name: 'Báo cáo tài chính, thuế, quản trị đúng hạn và chính xác', perspective: 'PRO', unit: 'COUNT', method: 'CM-BINARY', source: 'CMS', aggregation: 'LAST', tag: 'VOLUME', definition: 'Đưa đủ báo cáo lên CMS đúng hạn', formula: null, targetType: 'TEXT' },
  { code: 'KPI-HO-SO-QT', name: 'Hoàn thiện hồ sơ quyết toán', perspective: 'PRO', unit: 'PCT', method: 'CM-UP', source: 'MANUAL', aggregation: 'AVG', tag: 'VOLUME', definition: 'Tỉ lệ hồ sơ quyết toán hoàn thiện trong kỳ', formula: null },
  { code: 'KPI-HTK-CONG-NO', name: 'Kiểm soát hàng tồn kho (công nợ / tồn kho)', perspective: 'PRO', unit: 'RATIO', method: 'CM-BINARY', source: 'MHTC', aggregation: 'LAST', tag: 'COST', definition: 'Đạt khi công nợ / hàng tồn kho ≥ 1', formula: 'Công nợ / hàng tồn kho' }, // Q14: a threshold, so BINARY (actual ≥ target)
  { code: 'KPI-HE-THONG', name: 'Xây dựng hệ thống (cơ chế, quy trình, chính sách)', perspective: 'PRO', unit: 'COUNT', method: 'CM-UP', source: 'MANUAL', aggregation: 'SUM', tag: 'VOLUME', definition: null, formula: null },
  // Học hỏi & phát triển
  { code: 'KPI-NHAN-SU', name: 'Nhân sự', perspective: 'LNG', unit: 'PERSON', method: 'CM-UP', source: 'HRIS', aggregation: 'LAST', tag: null, definition: 'Tổng số nhân sự cuối kỳ', formula: null },
  { code: 'KPI-NSLD', name: 'Năng suất lao động', perspective: 'LNG', unit: 'VND', method: 'CM-UP', source: 'MHTC', aggregation: 'AVG', tag: 'EFFICIENCY', definition: 'Doanh thu / tổng số lượng nhân sự', formula: null },
  { code: 'KPI-TUYEN-DUNG', name: 'Tuyển dụng nhân sự mới', perspective: 'LNG', unit: 'PERSON', method: 'CM-UP', source: 'HRIS', aggregation: 'SUM', tag: 'VOLUME', definition: 'Số nhân sự được onboard trong tháng và hiện còn làm việc', formula: null },
  { code: 'KPI-GIU-CHAN-NS', name: 'Tỉ lệ nhân sự mới còn làm việc', perspective: 'LNG', unit: 'PCT', method: 'CM-UP', source: 'HRIS', aggregation: 'AVG', tag: 'VOLUME', definition: 'Số nhân sự mới đang làm việc / số nhân sự mới onboard trong tháng', formula: null },
  { code: 'KPI-NS-XEP-HANG', name: 'Tỉ lệ nhân sự đạt hạng A+/A/B', perspective: 'LNG', unit: 'PCT', method: 'CM-UP', source: 'MANUAL', aggregation: 'AVG', tag: 'EFFICIENCY', definition: '80% nhân sự đạt hạng A+/A/B (phụ thuộc thang xếp loại, ASSUMPTION Q2)', formula: null },
  { code: 'KPI-DAO-TAO', name: 'Chương trình đào tạo đạt kết quả', perspective: 'LNG', unit: 'COUNT', method: 'CM-UP', source: 'MANUAL', aggregation: 'SUM', tag: null, definition: null, formula: null, status: 'Draft' }, // Q14: placeholder row in the sheet
  { code: 'KPI-SU-KIEN', name: 'Sự kiện nội bộ đạt mức hài lòng', perspective: 'LNG', unit: 'PCT', method: 'CM-UP', source: 'MANUAL', aggregation: 'AVG', tag: null, definition: null, formula: null, status: 'Draft' }, // Q14: placeholder row
  { code: 'KPI-EMPLOYER-BRAND', name: 'Phát triển thương hiệu tuyển dụng (EB)', perspective: 'LNG', unit: 'COUNT', method: 'CM-UP', source: 'MANUAL', aggregation: 'SUM', tag: 'EFFICIENCY', definition: 'Lượt tiếp cận, tương tác; mức độ hài lòng của ứng viên', formula: null, status: 'Draft' }, // Q14: placeholder row
  { code: 'KPI-CUOC-GOI-CSKH', name: 'Số cuộc gọi chăm sóc khách hàng', perspective: 'CUS', unit: 'COUNT', method: 'CM-UP', source: 'CRM_CSKH', aggregation: 'SUM', tag: 'VOLUME', definition: 'Chỉ tiêu cũ, thay bằng tỉ lệ kết nối hai chiều', formula: null, status: 'Archived' },
];

export interface TemplateSpec {
  code: string;
  name: string;
  /** The org unit code, or `null` for a DATX set with no unit in Syntra's org (decision D-c). */
  unit: string | null;
  /** `[kpiCode, defaultWeight, defaultTarget]` — weights sum to 100 (Q14 normalised where not). */
  items: readonly [string, number, number | null][];
}

/** The 15 DATX sets. Targets are MONTHLY, as the sheet's definitions say ("phát sinh trong tháng"). */
export const TEMPLATES: readonly TemplateSpec[] = [
  { code: 'TPL-CONG-TY', name: 'Bộ KPI toàn công ty', unit: 'SYN', items: [['KPI-DOANH-THU', 20, 13_400_000_000], ['KPI-TSLN', 20, 15], ['KPI-SO-KH', 10, 28_957], ['KPI-TL-KH-CU', 20, 33], ['KPI-NHAN-SU', 10, 130], ['KPI-NSLD', 20, 90_000_000]] },
  // Q14: the sheet's weights sum to 80% — every weight scaled by 1.25.
  { code: 'TPL-MARKETING', name: 'Bộ KPI Marketing', unit: 'MKT', items: [['KPI-DOANH-THU', 25, 13_400_000_000], ['KPI-LN-THUAN', 25, 1_942_000_000], ['KPI-SO-KH', 12.5, 26_626], ['KPI-SO-KH-CU', 12.5, 8_077], ['KPI-NS-XEP-HANG', 12.5, 80], ['KPI-TUYEN-DUNG', 12.5, 50]] },
  // Q14: "Tỉ lệ KH hài lòng" had no weight — given 5, taken from "Số sản phẩm mới" (40 → 35).
  { code: 'TPL-NOI-DUNG-SO', name: 'Bộ KPI Ngành hàng Nội dung số', unit: null, items: [['KPI-SP-MOI', 35, null], ['KPI-CP-LUONG', 10, null], ['KPI-CP-VAN-HANH', 10, null], ['KPI-TUYEN-DUNG', 10, null], ['KPI-DAU', 10, null], ['KPI-INFLUENCER', 20, null], ['KPI-TL-HAI-LONG', 5, null]] },
  { code: 'TPL-LOI-SONG', name: 'Bộ KPI Ngành hàng Lối sống', unit: null, items: [['KPI-DT-SAN-PHAM', 20, null], ['KPI-SP-MOI', 40, null], ['KPI-SP-PHU-MOI', 10, null], ['KPI-TL-HAI-LONG', 10, null], ['KPI-CP-LUONG', 10, null], ['KPI-CP-VAN-HANH', 10, null]] },
  { code: 'TPL-MEDIA', name: 'Bộ KPI Media', unit: null, items: [['KPI-CP-LUONG', 10, null], ['KPI-CP-VAN-HANH', 10, null], ['KPI-QMR', 40, null], ['KPI-ORDER-DUNG-HAN', 40, null]] },
  // DATX "Tư vấn" = Syntra's Kinh doanh department (D-c). Q14: "CR/AOV/HH" (20%) split 5/10/5; the garbled salary target "38Đ" left blank.
  { code: 'TPL-KINH-DOANH', name: 'Bộ KPI Kinh doanh (Tư vấn)', unit: 'KDBH', items: [['KPI-DOANH-THU', 20, 13_659_000_000], ['KPI-LN-THUAN', 30, 1_830_000_000], ['KPI-CP-LUONG', 20, null], ['KPI-CR', 5, 10], ['KPI-AOV', 10, 600_000], ['KPI-HOA-HONG', 5, 4], ['KPI-GIU-CHAN-NS', 10, 70]] },
  { code: 'TPL-CSKH', name: 'Bộ KPI Chăm sóc khách hàng', unit: 'CSKH', items: [['KPI-TL-KHIEU-NAI', 30, null], ['KPI-TL-KH-SUCCESS', 30, null], ['KPI-TL-KET-NOI', 30, null], ['KPI-CP-LUONG', 10, 1.03]] },
  // Q14: row 1 split into its two measures (20% → 10 + 10).
  { code: 'TPL-MUA-HANG', name: 'Bộ KPI Mua hàng', unit: 'MH', items: [['KPI-CP-MUA-HANG', 10, null], ['KPI-DUT-HANG', 10, 0], ['KPI-TON-KHO', 20, null], ['KPI-XA-TON', 20, null], ['KPI-LEAD-TIME', 20, null], ['KPI-DAM-BAO-HANG', 10, null], ['KPI-TL-KN-CLSP', 10, null]] },
  { code: 'TPL-VAN-HANH', name: 'Bộ KPI Vận hành', unit: 'VHN', items: [['KPI-TL-HOAN-HUY', 30, null], ['KPI-CP-LUONG', 30, null], ['KPI-CP-DONG-GOI', 20, null], ['KPI-CP-BU-SHIP', 20, null]] }, // Q14: "21.000.000đ" per order is not a usable target — left blank
  // Q14: weights sum to 90% — "Lãi gộp" 30 → 40.
  { code: 'TPL-CUA-HANG', name: 'Bộ KPI Cửa hàng', unit: null, items: [['KPI-DOANH-THU', 20, null], ['KPI-LAI-GOP', 40, null], ['KPI-LEAD', 20, null], ['KPI-AOV', 10, null], ['KPI-CR', 10, null]] },
  { code: 'TPL-SAN-PHAM', name: 'Bộ KPI Sản phẩm', unit: null, items: [['KPI-CP-LUONG', 10, 0.53], ['KPI-TINH-NANG', 30, null], ['KPI-NGAN-SACH-QC', 20, 28.5], ['KPI-MY-RESULT', 20, 100], ['KPI-DAU', 20, 33_000]] },
  { code: 'TPL-CONG-NGHE', name: 'Bộ KPI Công nghệ', unit: 'CN', items: [['KPI-CP-LUONG', 10, 1.07], ['KPI-CP-VAN-HANH', 10, 0.68], ['KPI-TINH-NANG', 20, null], ['KPI-NGAN-SACH-QC', 10, 28.5], ['KPI-MY-RESULT', 10, 100], ['KPI-DAU', 10, 33_000], ['KPI-LOI-LON', 15, null], ['KPI-HIEU-NANG', 15, 400]] },
  { code: 'TPL-HCNS', name: 'Bộ KPI Hành chính nhân sự', unit: 'HCNS', items: [['KPI-TUYEN-DUNG', 20, null], ['KPI-CP-LUONG', 10, null], ['KPI-CP-VAN-HANH', 10, null], ['KPI-NSLD', 20, null], ['KPI-HE-THONG', 10, null], ['KPI-DAO-TAO', 10, null], ['KPI-SU-KIEN', 10, null], ['KPI-EMPLOYER-BRAND', 10, null]] },
  { code: 'TPL-KE-TOAN', name: 'Bộ KPI Kế toán', unit: 'KT', items: [['KPI-TSLN', 20, 10], ['KPI-DONG-TIEN', 20, null], ['KPI-HTK-CONG-NO', 10, 1], ['KPI-CP-LUONG', 10, null], ['KPI-CP-VAN-HANH', 10, null], ['KPI-HO-SO-QT', 20, null], ['KPI-BCTC-DUNG-HAN', 10, null]] },
  { code: 'TPL-KE-HOACH', name: 'Bộ KPI Kế hoạch', unit: 'KH', items: [['KPI-DOANH-THU', 10, 13_400_000_000], ['KPI-TSLN', 20, 15], ['KPI-SO-KH', 10, 28_957], ['KPI-TL-KH-CU', 20, 33], ['KPI-NSLD', 20, 90_000_000], ['KPI-HT-KPI-BP', 20, 80]] },
];

// ─── Workflows (sample SLAs, not sourced — business-rules BR-KPI-12, 13, 16) ──────────────────

export interface StepSpec {
  name: string;
  actorRule: ActorRule;
  allowedActions: readonly AllowedStepAction[];
  slaDays: number | null;
  onOverdue: OverdueBehaviour | null;
  remindDaysBefore: number | null;
  evaluationColumn: EvaluationColumn | null;
  requiresComment: boolean;
}

export const WORKFLOWS: readonly { key: FormType; name: string; steps: readonly StepSpec[] }[] = [
  {
    key: 'GOAL_SETTING',
    name: 'Đăng ký KPI (4 bước)',
    steps: [
      { name: 'Quản lý giao chỉ tiêu', actorRule: 'DIRECT_MANAGER', allowedActions: ['SUBMIT', 'EDIT'], slaDays: 3, onOverdue: 'LOCK', remindDaysBefore: 1, evaluationColumn: null, requiresComment: false },
      { name: 'Nhân viên bổ sung và liên kết', actorRule: 'SELF', allowedActions: ['SUBMIT', 'EDIT'], slaDays: 3, onOverdue: 'LOCK', remindDaysBefore: 1, evaluationColumn: null, requiresComment: false },
      { name: 'Quản lý duyệt', actorRule: 'DIRECT_MANAGER', allowedActions: ['APPROVE', 'RETURN', 'EDIT'], slaDays: 3, onOverdue: 'LOCK', remindDaysBefore: 1, evaluationColumn: null, requiresComment: false },
      // PEND-02: HR may send the plan back to the manager (RETURN → the previous step, 3).
      { name: 'HR ghi nhận và khóa', actorRule: 'HR', allowedActions: ['APPROVE', 'RETURN', 'EDIT'], slaDays: 2, onOverdue: 'LOCK', remindDaysBefore: 1, evaluationColumn: null, requiresComment: false },
    ],
  },
  {
    key: 'GOAL_CHANGE',
    name: 'Điều chỉnh KPI (3 bước)',
    steps: [
      { name: 'Nhân viên đề xuất điều chỉnh', actorRule: 'SELF', allowedActions: ['SUBMIT', 'EDIT'], slaDays: 3, onOverdue: 'REMIND', remindDaysBefore: null, evaluationColumn: null, requiresComment: false },
      { name: 'Quản lý duyệt điều chỉnh', actorRule: 'DIRECT_MANAGER', allowedActions: ['APPROVE', 'RETURN'], slaDays: 3, onOverdue: 'REMIND', remindDaysBefore: null, evaluationColumn: null, requiresComment: false },
      { name: 'HR ghi nhận điều chỉnh', actorRule: 'HR', allowedActions: ['APPROVE'], slaDays: 2, onOverdue: 'REMIND', remindDaysBefore: null, evaluationColumn: null, requiresComment: false },
    ],
  },
  {
    key: 'KPI_EVAL',
    name: 'Đánh giá KPI hằng tháng (3 bước)',
    steps: [
      { name: 'Tự đánh giá', actorRule: 'SELF', allowedActions: ['SUBMIT', 'EDIT'], slaDays: 6, onOverdue: 'AUTO_FORWARD', remindDaysBefore: 1, evaluationColumn: 'SELF', requiresComment: true },
      { name: 'Quản lý đánh giá', actorRule: 'DIRECT_MANAGER', allowedActions: ['SUBMIT', 'RETURN', 'EDIT'], slaDays: 4, onOverdue: 'REMIND', remindDaysBefore: 1, evaluationColumn: 'MANAGER', requiresComment: false },
      { name: 'HR ghi nhận kết quả', actorRule: 'HR', allowedActions: ['APPROVE', 'RETURN', 'EDIT'], slaDays: 2, onOverdue: 'REMIND', remindDaysBefore: 1, evaluationColumn: 'FINAL', requiresComment: false },
    ],
  },
  // Monthly work (PEND-14, plan §6–§7). Sample SLAs: the plan is due 7 days after its launch on day 1
  // (`ASSUMPTION Q65` proposes day 5); the review runs like the KPI evaluation (6 / 4 / 2 days).
  {
    key: 'WORK_PLAN',
    name: 'Kế hoạch công việc tháng (3 bước)',
    // Top-down or bottom-up by the launch's "Bắt đầu từ" (PEND-01's startStepNo, monthly plan §6): step 1 when
    // the manager assigns first, step 2 when the employee writes the list herself (CMC's usual way).
    steps: [
      { name: 'Quản lý giao việc', actorRule: 'DIRECT_MANAGER', allowedActions: ['SUBMIT', 'EDIT'], slaDays: 2, onOverdue: 'REMIND', remindDaysBefore: 1, evaluationColumn: null, requiresComment: false },
      { name: 'Nhân viên lập kế hoạch', actorRule: 'SELF', allowedActions: ['SUBMIT', 'EDIT'], slaDays: 3, onOverdue: 'AUTO_FORWARD', remindDaysBefore: 1, evaluationColumn: null, requiresComment: false },
      { name: 'Quản lý duyệt kế hoạch', actorRule: 'DIRECT_MANAGER', allowedActions: ['APPROVE', 'RETURN', 'EDIT'], slaDays: 3, onOverdue: 'REMIND', remindDaysBefore: 1, evaluationColumn: null, requiresComment: false },
    ],
  },
  {
    key: 'WORK_REVIEW',
    name: 'Đánh giá công việc tháng (3 bước)',
    steps: [
      { name: 'Tự đánh giá công việc', actorRule: 'SELF', allowedActions: ['SUBMIT', 'EDIT'], slaDays: 6, onOverdue: 'AUTO_FORWARD', remindDaysBefore: 1, evaluationColumn: 'SELF', requiresComment: false },
      { name: 'Quản lý đánh giá công việc', actorRule: 'DIRECT_MANAGER', allowedActions: ['SUBMIT', 'RETURN', 'EDIT'], slaDays: 4, onOverdue: 'REMIND', remindDaysBefore: 1, evaluationColumn: 'MANAGER', requiresComment: false },
      { name: 'HR ghi nhận kết quả', actorRule: 'HR', allowedActions: ['APPROVE', 'RETURN', 'EDIT'], slaDays: 2, onOverdue: 'REMIND', remindDaysBefore: 1, evaluationColumn: 'FINAL', requiresComment: false },
    ],
  },
];

/** The monthly work plan is due 7 days after its launch on day 1 (sample, `ASSUMPTION Q65`). */
export const WORK_PLAN_DUE_DAYS = 7;

/** Where a bottom-up monthly plan starts: the employee's step of the WORK_PLAN workflow (`FormLaunch.startStepNo`). */
export const WORK_PLAN_BOTTOM_UP_STEP = 2;

/** The monthly evaluation launches itself: PERIOD_END + 1 day, due 12 days later (SLAs sum to 12). */
export const EVAL_DUE_DAYS = 12;

// ─── Rating and pay — ASSUMPTION Q2 (the DATX "TH KQ" sheet is broken) ─────────────────────────

/** Contiguous from 0, half-open `[min, max)` per ratingRules; the top level's max is the 120% cap. */
export const RATING_LEVELS: readonly { code: string; label: string; min: number; max: number; payout: number }[] = [
  { code: 'A+', label: 'Xuất sắc', min: 110, max: 120, payout: 120 },
  { code: 'A', label: 'Tốt', min: 100, max: 110, payout: 100 },
  { code: 'B', label: 'Đạt', min: 90, max: 100, payout: 80 },
  { code: 'C', label: 'Cần cải thiện', min: 70, max: 90, payout: 50 },
  { code: 'D', label: 'Không đạt', min: 0, max: 70, payout: 0 },
];

// ─── Notification templates (Vietnamese; FORM_LAUNCHED and DEADLINE_REMIND follow the email template) ─

export const NOTIFICATION_TEXTS: readonly { event: NotificationEvent; channel: NotificationChannel; subject: string; body: string }[] = [
  {
    event: 'FORM_LAUNCHED',
    channel: 'InApp',
    subject: 'Đợt {{formType}} {{period}} đã bắt đầu',
    body: 'Quy trình gồm {{stepCount}} bước; hiện bạn ở bước {{stepNo}} – {{stepName}}. Hạn hoàn thành: {{dueDate}}.',
  },
  {
    event: 'STEP_ASSIGNED',
    channel: 'InApp',
    subject: 'Bạn có phiếu {{formType}} cần xử lý',
    body: 'Phiếu {{formType}} của {{subjectName}} đang chờ bạn ở bước {{stepName}}. Hạn: {{dueDate}}.',
  },
  {
    event: 'DEADLINE_REMIND',
    channel: 'InApp',
    subject: 'Sắp đến hạn bước {{stepName}}',
    body: 'Hạn của bước {{stepName}} trên phiếu của {{subjectName}} là {{dueDate}}. {{consequence}}',
  },
  {
    event: 'RETURNED',
    channel: 'InApp',
    subject: 'Phiếu {{formType}} đã bị trả lại',
    body: '{{actorName}} đã trả lại phiếu {{formType}} của {{subjectName}}. Lý do: {{reason}}.',
  },
  {
    event: 'FORM_LAUNCHED',
    channel: 'Email',
    subject: '[Syntra KPI] Khởi chạy {{formType}} {{period}}',
    body: 'Kính gửi {{recipientName}},\n\nĐợt {{formType}} {{period}} đã bắt đầu. Hạn hoàn thành: {{dueDate}}.\n\nTrân trọng,\nPhòng Hành chính nhân sự',
  },
];
