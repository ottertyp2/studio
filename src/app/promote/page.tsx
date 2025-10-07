
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, useFirebase } from '@/firebase';
import { collection, getDocs, query, where, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

export default function PromotePage() {
  const router = useRouter();
  const { user, isUserLoading, userRole } = useUser();
  const { firestore } = useFirebase();
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [adminExists, setAdminExists] = useState(true);

  useEffect(() => {
    if (isUserLoading) {
      return;
    }
    if (!user) {
      router.replace('/login?redirect=/promote');
      return;
    }

    const checkAdmin = async () => {
      setIsLoading(true);
      const usersRef = collection(firestore, 'users');
      const q = query(usersRef, where('role', '==', 'superadmin'));
      const querySnapshot = await getDocs(q);
      setAdminExists(!querySnapshot.empty);
      setIsLoading(false);
    };

    checkAdmin();
  }, [user, isUserLoading, firestore, router]);

  const handlePromote = async () => {
    if (!user) {
      toast({ variant: 'destructive', title: 'Error', description: 'You must be logged in.' });
      return;
    }
    setIsLoading(true);
    try {
      const userDocRef = doc(firestore, 'users', user.uid);
      await updateDoc(userDocRef, { role: 'superadmin' });
      toast({
        title: 'Promotion Successful!',
        description: 'You are now a superadmin. Redirecting to the admin panel...',
      });
      router.push('/admin');
    } catch (error: any) {
      console.error('Promotion failed:', error);
      toast({
        variant: 'destructive',
        title: 'Promotion Failed',
        description: error.message || 'Could not update your role.',
      });
      setIsLoading(false);
    }
  };

  const renderContent = () => {
    if (isLoading || isUserLoading) {
      return <p>Checking status...</p>;
    }
    if (userRole === 'superadmin') {
        return (
            <>
                <p className="text-lg text-primary">You are already a superadmin.</p>
                <Button onClick={() => router.push('/admin')} className="mt-4">Go to Admin Panel</Button>
            </>
        )
    }
    if (adminExists) {
      return <p className="text-destructive">A superadmin already exists. This page can only be used for the initial setup.</p>;
    }
    return (
      <>
        <p className="text-lg">No superadmin found.</p>
        <p className="text-muted-foreground">Click the button below to elevate your account, <span className="font-semibold text-foreground">{user?.email || user?.displayName}</span>, to a superadmin role.</p>
        <Button onClick={handlePromote} disabled={isLoading} className="mt-6 btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1">
          {isLoading ? 'Promoting...' : 'Promote to Superadmin'}
        </Button>
      </>
    );
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-slate-200 p-4">
      <Card className="w-full max-w-md bg-white/80 backdrop-blur-sm shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">Admin Promotion</CardTitle>
          <CardDescription>Elevate your user account to gain administrative privileges.</CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          {renderContent()}
        </CardContent>
      </Card>
    </div>
  );
}
