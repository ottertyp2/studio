
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { initiateEmailSignIn } from '@/firebase/non-blocking-login';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { collection } from 'firebase/firestore';

const formSchema = z.object({
  emailOrUsername: z.string().min(1, { message: 'Please enter your email or username.' }),
  password: z.string().min(6, { message: 'Password must be at least 6 characters.' }),
});

type AppUser = {
  id: string;
  username: string;
  email: string;
  role: 'user' | 'superadmin';
};


export default function LoginPage() {
  const router = useRouter();
  const { auth, firestore } = useFirebase();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [showAdminPromotion, setShowAdminPromotion] = useState(false);

  const usersCollectionRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'users');
  }, [firestore]);

  const { data: users, isLoading: isUsersLoading, error: usersError } = useCollection<AppUser>(usersCollectionRef);

  useEffect(() => {
    if (!firestore || isUsersLoading) {
      return;
    }
    
    // Only show promotion if there are no users at all, or no superadmin.
    // The `users === null` check handles the case where the unauthenticated read fails, which is expected.
    if (users === null || users.length === 0 || !users.some(u => u.role === 'superadmin')) {
        setShowAdminPromotion(true);
    } else {
        setShowAdminPromotion(false);
    }
  }, [users, isUsersLoading, firestore]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      emailOrUsername: '',
      password: '',
    },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsLoading(true);
    if (!auth || !firestore) {
      toast({
        variant: 'destructive',
        title: 'Configuration Error',
        description: 'Firebase is not initialized correctly.',
      });
      setIsLoading(false);
      return;
    }
    try {
      await initiateEmailSignIn(auth, firestore, values.emailOrUsername, values.password);
      toast({
        title: 'Sign In Successful',
        description: "You are now being redirected.",
      });
      // The onAuthStateChanged listener in useUser will handle the redirect
      router.push('/');
    } catch (error: any) {
      let errorMessage = error.message;
      if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential' || error.message.includes('User not found') || error.code?.includes('auth/invalid-value')) {
          errorMessage = 'Invalid credentials. Please check your email/username and password.';
      }
      toast({
        variant: 'destructive',
        title: 'Sign In Failed',
        description: errorMessage,
      });
       console.error(error);
    } finally {
        setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-slate-200 p-4">
      <Card className="w-full max-w-md bg-white/80 backdrop-blur-sm shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">Welcome Back</CardTitle>
          <CardDescription>Sign in to access the dashboard</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="emailOrUsername"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email or Username</FormLabel>
                    <FormControl>
                      <Input placeholder="your_username or name@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1" disabled={isLoading}>
                {isLoading ? 'Signing In...' : 'Sign In'}
              </Button>
            </form>
          </Form>
           <div className="mt-6 text-center text-sm">
            Don't have an account?{' '}
            <Link href="/signup" className="underline text-primary">
              Sign up
            </Link>
          </div>
           {showAdminPromotion && (
            <div className="mt-4 text-center text-xs text-muted-foreground">
              First time setup?{' '}
              <Link href="/promote" className="underline text-primary">
                Promote to Admin
              </Link>
            </div>
           )}
        </CardContent>
      </Card>
    </div>
  );
}
