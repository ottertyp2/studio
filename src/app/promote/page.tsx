
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, useFirebase } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';

export default function PromotePage() {
  const router = useRouter();
  const { user, isUserLoading, userRole } = useUser();
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const [isPromoting, setIsPromoting] = useState(false);

  const handlePromote = async () => {
    if (!user || !firestore) {
      toast({ variant: 'destructive', title: 'Error', description: 'You must be logged in to promote an account.' });
      return;
    }
    setIsPromoting(true);
    try {
      const userDocRef = doc(firestore, 'users', user.uid);
      await updateDoc(userDocRef, { role: 'superadmin' });
      toast({
        title: 'Promotion Successful!',
        description: 'You are now a superadmin. Redirecting to the admin panel...',
      });
      // Force a refresh of the user data to reflect the new role
      await user.getIdToken(true); 
      router.push('/admin');
    } catch (error: any) {
      console.error('Promotion failed:', error);
      toast({
        variant: 'destructive',
        title: 'Promotion Failed',
        description: error.message || 'Could not update your role.',
      });
    } finally {
      setIsPromoting(false);
    }
  };

  const renderContent = () => {
    if (isUserLoading) {
      return <p>Checking system status...</p>;
    }

    if (userRole === 'superadmin') {
      return (
          <>
              <p className="text-lg text-primary">You are already a superadmin.</p>
              <Button onClick={() => router.push('/admin')} className="mt-4">Go to Admin Panel</Button>
          </>
      )
    }
    
    if (!user) {
        return (
             <>
                <p className="text-lg">Ready to create an admin account.</p>
                <p className="text-sm text-muted-foreground mt-2">Please <Link href="/login" className="underline text-primary">sign in</Link> or <Link href="/signup" className="underline text-primary">create an account</Link> first. Once logged in, return to this page to promote your account.</p>
            </>
        )
    }

    return (
      <>
        <p className="text-lg">Click the button below to elevate your account, <span className="font-semibold text-foreground">{user.email}</span>, to a superadmin role.</p>
        <Button onClick={handlePromote} disabled={isPromoting} className="mt-6 btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1">
          {isPromoting ? 'Promoting...' : 'Promote My Account to Superadmin'}
        </Button>
      </>
    );
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-slate-200 p-4">
      <Card className="w-full max-w-lg bg-white/80 backdrop-blur-sm shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">Admin Promotion</CardTitle>
          <CardDescription>Elevate a user account to have superadmin privileges.</CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          {renderContent()}
        </CardContent>
      </Card>
    </div>
  );
}
