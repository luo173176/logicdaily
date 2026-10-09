import type { Metadata } from 'next';

import { HomeView } from '@/features/home/home-view';

export const metadata: Metadata = { title: '今日训练' };

export default function HomePage() {
  return <HomeView />;
}
