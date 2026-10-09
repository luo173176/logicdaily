import type { Metadata } from 'next';

import { MaterialCoachView } from '@/features/coach/material-view';

export const metadata: Metadata = { title: '材料论证分析' };

export default function CoachPage() {
  return <MaterialCoachView />;
}
