import type { Metadata } from 'next';

import { ReviewView } from '@/features/review/review-view';

export const metadata: Metadata = { title: '复习' };

export default function ReviewPage() {
  return <ReviewView />;
}
