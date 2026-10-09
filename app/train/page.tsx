import type { Metadata } from 'next';

import { TrainingView } from '@/features/training/training-view';

export const metadata: Metadata = { title: '训练' };

export default function TrainPage() {
  return <TrainingView />;
}
