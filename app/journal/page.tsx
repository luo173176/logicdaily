import { Suspense } from 'react';
import type { Metadata } from 'next';

import { JournalScreen } from '@/features/journal/journal-views';
import { Skeleton } from '@/components/ui';

export const metadata: Metadata = { title: '思考日志' };

export default function JournalPage() {
  return (
    // useSearchParams 需要 Suspense 边界，静态外壳才能先渲染出来
    <Suspense fallback={<Skeleton lines={6} />}>
      <JournalScreen />
    </Suspense>
  );
}
