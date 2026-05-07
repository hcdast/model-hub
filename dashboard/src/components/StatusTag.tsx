import { Tag } from 'antd';

const colorMap: Record<string, string> = {
  PENDING: 'default',
  SUBMITTED: 'processing',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  FAILED: 'error',
  TIMEOUT: 'warning',
  CANCELLED: 'default',
  // Link conversion statuses (lowercase)
  pending: 'default',
  processing: 'processing',
  completed: 'success',
  failed: 'error',
  cancelled: 'default',
};

export default function StatusTag({ status }: { status: string }) {
  return <Tag color={colorMap[status] || 'default'}>{status}</Tag>;
}
