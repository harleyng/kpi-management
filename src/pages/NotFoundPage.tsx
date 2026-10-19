import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { EmptyStateCard } from '@/components/shared/EmptyState';
import { PageHeader } from '@/components/shared/PageHeader';
import { HOME_URL } from '@/components/layout/navConfig';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="Không tìm thấy trang" />
      <EmptyStateCard
        className="max-w-md"
        action={<Button onClick={() => navigate(HOME_URL)}>Về KPI của tôi</Button>}
      >
        Địa chỉ này không có trong Syntra KPI.
      </EmptyStateCard>
    </>
  );
}
