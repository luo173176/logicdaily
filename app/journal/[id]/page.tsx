'use client';

import { useParams } from 'next/navigation';
import { Suspense } from 'react';

import { JournalEditorView } from '@/features/journal/journal-views';
import { Skeleton } from '@/components/ui';

/**
 * 动态 id 在客户端读取：这个应用的数据都在本机 IndexedDB，
 * 服务端既拿不到也不需要拿到这些参数，因此不产生任何跨用户读取面。
 */
function EditorByParams() {
  const params = useParams<{ id: string }>();
  return <JournalEditorView journalId={params?.id} />;
}

export default function JournalDetailPage() {
  return (
    <Suspense fallback={<Skeleton lines={6} />}>
      <EditorByParams />
    </Suspense>
  );
}
