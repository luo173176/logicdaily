import type { Metadata } from 'next';

import { OnboardingView } from '@/features/onboarding/onboarding-view';

export const metadata: Metadata = { title: '新手引导' };

export default function OnboardingPage() {
  return <OnboardingView />;
}
