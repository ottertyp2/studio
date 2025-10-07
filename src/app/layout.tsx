
'use client';
import './globals.css';
import { Inter } from 'next/font/google';
import { Toaster } from "@/components/ui/toaster";
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { initializeFirebase } from '@/firebase';
import packageJson from '@/../package.json';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { firebaseApp, firestore, auth } = initializeFirebase();
  const version = packageJson.version;

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
        <div className="fixed bottom-2 right-2 text-xs text-muted-foreground bg-background/50 backdrop-blur-sm px-2 py-1 rounded-md z-50">
          v{version}
        </div>
      </body>
    </html>
  );
}
