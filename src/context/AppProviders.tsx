'use client';

import { ReactNode } from 'react';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { initializeFirebase } from '@/firebase';
import { TestBenchProvider } from '@/context/TestBenchProvider';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';

export function AppProviders({ children }: { children: ReactNode }) {
  const { firebaseApp, firestore, auth, storage, database } = initializeFirebase();

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <FirebaseClientProvider
        firebaseApp={firebaseApp}
        auth={auth}
        firestore={firestore}
        storage={storage}
        database={database}
      >
        <TestBenchProvider>
          {children}
        </TestBenchProvider>
      </FirebaseClientProvider>
      <div className="fixed bottom-2 left-2 z-50">
        <ThemeToggle />
      </div>
    </ThemeProvider>
  );
}
