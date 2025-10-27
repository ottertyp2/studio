
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase';

export default function HomePage() {
  const router = useRouter();
  const { user, isUserLoading } = useUser();

  useEffect(() => {
    // Only perform redirection once the user loading state is resolved.
    if (!isUserLoading) {
      if (user) {
        // If a user is logged in, redirect them to the main testing dashboard.
        router.replace('/testing');
      } else {
        // If no user is logged in, redirect them to the login page.
        router.replace('/login');
      }
    }
  }, [user, isUserLoading, router]);

  // Render a full-page loading indicator while the auth state is being determined.
  // This prevents any content from flashing before the redirect happens.
  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background to-blue-200 dark:to-blue-950">
      <p className="text-lg">Loading...</p>
    </div>
  );
}
