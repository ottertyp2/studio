
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, useFirebase } from '@/firebase';
import { collection, getDocs, query, where, doc, updateDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';

export default function PromotePage() {
  const router = useRouter();
  const { user, isUserLoading, userRole } = useUser();
  const { firestore } = useFirebase();
  const { toast } = useToast();

  const [isChecking, setIsChecking] = useState(true);
  const [adminExists, setAdminExists] = useState(false);
  const [isPromoting, setIsPromoting] = useState(false);

  useEffect(() => {
    if (isUserLoading) {
      return;
    }
    
    // This check runs regardless of whether a user is logged in.
    const checkAdmin = async () => {
      if (!firestore) return;
      setIsChecking(true);
      try {
        const usersRef = collection(firestore, 'users');
        const q = query(usersRef, where('role', '==', 'superadmin'));
        const querySnapshot = await getDocs(q);
        setAdminExists(!querySnapshot.empty);
      } catch (error) {
        console.error("Error checking for admin:", error);
        // In case of error, assume no admin exists to allow promotion attempt
        setAdminExists(false);
      } finally {
        setIsChecking(false);
      }
    };

    checkAdmin();
  }, [isUserLoading, firestore]);

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
    if (isChecking || isUserLoading) {
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

    if (adminExists) {
      return (
        <>
            <p className="text-destructive">A superadmin account already exists.</p>
            <p className="text-sm text-muted-foreground mt-2">This page is only for the initial application setup. Only one superadmin can be created through this process.</p>
            <Button onClick={() => router.push('/login')} className="mt-4">Go to Login</Button>
        </>
      );
    }
    
    if (!user) {
        return (
             <>
                <p className="text-lg">Ready to create the first admin.</p>
                <p className="text-sm text-muted-foreground mt-2">Please <Link href="/login" className="underline text-primary">sign in</Link> or <Link href="/signup" className="underline text-primary">create an account</Link> first. Once logged in, return to this page to promote your account.</p>
            </>
        )
    }

    return (
      <>
        <p className="text-lg">No superadmin found.</p>
        <p className="text-muted-foreground mt-2">Click the button below to elevate your account, <span className="font-semibold text-foreground">{user.email}</span>, to a superadmin role.</p>
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
          <CardDescription>Create the first superadmin account for the application.</CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          {renderContent()}
        </CardContent>
      </Card>
    </div>
  );
}
