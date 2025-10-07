
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase';

export default function HomePage() {
  const router = useRouter();
  const { user, isUserLoading } = useUser();

  useEffect(() => {
    // Only redirect once the loading state is false.
    if (!isUserLoading) {
      if (user) {
        // If user is logged in, redirect to the main testing dashboard.
        router.replace('/testing');
      } else {
        // If no user is logged in, redirect to the login page.
        router.replace('/login');
      }
    }
  }, [user, isUserLoading, router]);

  // Render a loading indicator while the auth state is being determined.
  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background to-slate-200">
      <p className="text-lg">Loading...</p>
    </div>
  );
}
