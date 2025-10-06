'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect immediately to the testing page
    router.replace('/testing');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background to-slate-200">
      <p className="text-lg">Redirecting to dashboard...</p>
    </div>
  );
}
