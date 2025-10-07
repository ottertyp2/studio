
'use client';
import './globals.css';
import { Inter } from 'next/font/google';
import { Toaster } from "@/components/ui/toaster";
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { initializeFirebase } from '@/firebase';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { firebaseApp, firestore, auth } = initializeFirebase();

  return (
    <html lang="en">
      <body className={inter.className}>
        <FirebaseClientProvider
          firebaseApp={firebaseApp}
          auth={auth}
          firestore={firestore}
        >
          {children}
        </FirebaseClientProvider>
        <Toaster />
      </body>
    </html>
  );
}
