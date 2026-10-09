import type { Metadata } from 'next';

import { JournalListView } from '@/features/journal/journal-views';

export const metadata: Metadata = { title: '思考日志' };

export default function JournalPage() {
  return <JournalListView />;
}
