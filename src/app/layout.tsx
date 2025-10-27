
'use client';
import './globals.css';
import { Inter } from 'next/font/google';
import { Toaster } from "@/components/ui/toaster";
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { initializeFirebase } from '@/firebase';
import packageJson from '@/../package.json';
import { TestBenchProvider } from '@/context/TestBenchProvider';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { firebaseApp, firestore, auth, storage, database } = initializeFirebase();
  const version = packageJson.version;

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
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
          <Toaster />
          <div className="fixed bottom-2 right-2 text-xs text-muted-foreground bg-background/50 backdrop-blur-sm px-2 py-1 rounded-md z-50">
            v{version}
          </div>
          <div className="fixed bottom-2 left-2 z-50">
            <ThemeToggle />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
