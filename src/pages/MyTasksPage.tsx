import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyStateCard } from '@/components/shared/EmptyState';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DelegationsPanel } from '@/components/forms/DelegationsPanel';
import { FormTypeSelect } from '@/components/forms/FormFilters';
import { FormsTable } from '@/components/forms/FormsTable';
import { useSession } from '@/contexts/useSession';
import type { FormType } from '@/data/types';
import { useForms, useInbox } from '@/hooks/queries/forms';

const TABS = ['inbox', 'mine', 'delegations'] as const;
type Tab = (typeof TABS)[number];

/**
 * "Việc cần xử lý" (WBS 4.5.5) — every role. The inbox holds the forms whose CURRENT step waits on
 * the user, as its actor or as a delegate (`forms.listInbox`, most urgent first); "Phiếu của tôi" the
 * forms about the user; "Ủy quyền" their delegations. HR acting as proxy finds forms on "Khởi chạy
 * phiếu" → "Phiếu" — proxy access is not an inbox.
 */
export default function MyTasksPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'inbox';
  const setTab = (next: string) => setParams(next === 'inbox' ? {} : { tab: next }, { replace: true });

  return (
    <>
      <PageHeader title="Việc cần xử lý" description="Các phiếu đang chờ bạn: đăng ký, điều chỉnh và đánh giá KPI." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="inbox">Cần xử lý</TabsTrigger>
          <TabsTrigger value="mine">Phiếu của tôi</TabsTrigger>
          <TabsTrigger value="delegations">Ủy quyền</TabsTrigger>
        </TabsList>
        <TabsContent value="inbox" className="mt-4">
          <InboxTab />
        </TabsContent>
        <TabsContent value="mine" className="mt-4">
          <MyFormsTab />
        </TabsContent>
        <TabsContent value="delegations" className="mt-4">
          <DelegationsPanel />
        </TabsContent>
      </Tabs>
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
