'use client';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { FirebaseProvider } from '@/firebase/provider';
import { initializeFirebase } from '@/firebase';
import { initiateAnonymousSignIn, useAuth } from '@/firebase';
import { useEffect } from 'react';

const inter = Inter({ subsets: ['latin'] });

// export const metadata: Metadata = {
//   title: 'Leak Detector',
//   description: 'AI-powered leak detection',
// };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { firebaseApp, firestore, auth } = initializeFirebase();
  
  useEffect(() => {
    initiateAnonymousSignIn(auth);
  }, [auth]);

  return (
    <html lang="en">
      <body className={inter.className}>
        <FirebaseProvider
          firebaseApp={firebaseApp}
          auth={auth}
          firestore={firestore}
        >
          {children}
        </FirebaseProvider>
        <Toaster />
      </body>
    </html>
  );
}
