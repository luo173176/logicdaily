import type { Metadata } from 'next';

import { StatsView } from '@/features/stats/stats-view';

export const metadata: Metadata = { title: '训练报告' };

export default function StatsPage() {
  return <StatsView />;
}
