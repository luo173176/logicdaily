import type { Metadata } from 'next';

import { JournalEditorView } from '@/features/journal/journal-views';

export const metadata: Metadata = { title: '新建思考日志' };

export default function NewJournalPage() {
  return <JournalEditorView />;
}
