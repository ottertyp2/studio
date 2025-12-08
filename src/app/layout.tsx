'use client';
import './globals.css';
import { Inter } from 'next/font/google';
import { Toaster } from "@/components/ui/toaster";
import packageJson from '@/../package.json';
import { AppProviders } from '@/context/AppProviders';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const version = packageJson.version;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
      </head>
      <body className={inter.className}>
        <AppProviders>
            {children}
            <Toaster />
            <div className="fixed bottom-2 right-2 text-xs text-muted-foreground bg-background/50 backdrop-blur-sm px-2 py-1 rounded-md z-50">
                v{version}
            </div>
        </AppProviders>
      </body>
    </html>
  );
}
    
