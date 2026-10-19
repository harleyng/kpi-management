import { useState } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyStateCard } from '@/components/shared/EmptyState';
import { DelegationsPanel } from '@/components/forms/DelegationsPanel';
import { FormTypeSelect } from '@/components/forms/FormFilters';
import { FormsTable } from '@/components/forms/FormsTable';
import { useSession } from '@/contexts/useSession';
import type { FormType } from '@/data/types';
import { useForms, useInbox } from '@/hooks/queries/forms';

export type MyTasksSection = 'inbox' | 'forms' | 'delegations';

const SECTIONS: Record<MyTasksSection, { title: string; description: string }> = {
  inbox: { title: 'Chờ tôi xử lý', description: 'Các phiếu đang chờ bạn ở bước hiện tại: đăng ký, điều chỉnh và đánh giá KPI.' },
  forms: { title: 'Phiếu của tôi', description: 'Mọi phiếu về KPI của bạn, kể cả phiếu đang ở bước của người khác.' },
  delegations: { title: 'Ủy quyền', description: 'Người được ủy quyền xử lý thay các bước của bạn trong thời gian ủy quyền. Lịch sử ghi nhận cả hai người.' },
};

/**
 * "Việc cần xử lý" (WBS 4.5.5) — every role; one sub-page per section. "Chờ tôi xử lý" holds the
 * forms whose CURRENT step waits on the user, as its actor or as a delegate (`forms.listInbox`, most
 * urgent first); "Phiếu của tôi" the forms about the user; "Ủy quyền" their delegations. HR acting as
 * proxy finds forms on "Khởi chạy phiếu" → "Phiếu đã tạo" — proxy access is not an inbox.
 */
export default function MyTasksPage({ section }: { section: MyTasksSection }) {
  const { title, description } = SECTIONS[section];
  return (
    <>
      <PageHeader title={title} description={description} />
      {section === 'inbox' ? <InboxTab /> : section === 'forms' ? <MyFormsTab /> : <DelegationsPanel />}
    </>
  );
}

function InboxTab() {
  const inbox = useInbox();
  const [type, setType] = useState<FormType | null>(null);
  const rows = inbox.data?.filter((f) => type === null || f.formType === type);
  return (
    <FormsTable
      label="Phiếu cần bạn xử lý"
      rows={rows}
      query={inbox}
      atMyStep="all"
      empty="Không có việc cần xử lý. Phiếu mới sẽ hiện ở đây khi đến lượt bạn."
      toolbar={<FormTypeSelect value={type} onChange={setType} />}
      isFiltered={type !== null}
      onClearFilters={() => setType(null)}
      pageResetKey={type}
    />
  );
}

/** The latest forms about the user — a person has a few a month, so one page of 200 holds them all. */
const MY_FORMS_LIMIT = 200;

function MyFormsTab() {
  const { user } = useSession();
  const inbox = useInbox();
  const forms = useForms(user.employeeId ? { subjectEmployeeIds: [user.employeeId] } : {}, { limit: MY_FORMS_LIMIT }, { enabled: user.employeeId !== null });
  const [type, setType] = useState<FormType | null>(null);

  if (user.employeeId === null) {
    return <EmptyStateCard>Tài khoản hệ thống không có phiếu của riêng mình.</EmptyStateCard>;
  }
  const rows = forms.data?.items.filter((f) => type === null || f.formType === type);
  return (
    <div className="space-y-2">
      <FormsTable
        label="Phiếu của tôi"
        rows={rows}
        query={forms}
        showSubject={false}
        atMyStep={new Set(inbox.data?.map((f) => f.id) ?? [])}
        empty="Bạn chưa có phiếu nào. Phiếu đăng ký và đánh giá KPI sẽ hiện ở đây khi HR khởi chạy."
        toolbar={<FormTypeSelect value={type} onChange={setType} />}
        isFiltered={type !== null}
        onClearFilters={() => setType(null)}
        pageResetKey={type}
      />
      {forms.data?.nextCursor && <p className="text-xs text-muted-foreground">Hiển thị {MY_FORMS_LIMIT} phiếu mới nhất.</p>}
    </div>
  );
}
