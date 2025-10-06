'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useFirebase } from '@/firebase';
import { FirebaseError } from 'firebase/app';
import { signInWithEmailAndPassword } from 'firebase/auth';

// No Zod schema for simplest validation

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const { auth } = useFirebase();
  const { toast } = useToast();

  const form = useForm({
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (values: {email: string, password: string}) => {
    if (!values.email || !values.password) {
        toast({
            variant: 'destructive',
            title: 'Login Failed',
            description: 'Please enter both username and password.',
        });
        return;
    }

    setIsLoading(true);
    try {
      if (!auth) throw new Error("Auth service not available");
      
      // Append dummy domain if it's not an email format
      const finalUsername = values.email.includes('@') ? values.email : `${values.email}@biothrust.local`;

      await signInWithEmailAndPassword(auth, finalUsername, values.password);
      toast({
        title: 'Login Successful',
        description: "You're now logged in.",
      });
      router.push('/');
    } catch (error) {
      let errorMessage = 'Invalid username or password.';
       if (error instanceof FirebaseError) {
        // Treat all auth errors as a generic invalid credential message.
        if (['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-email'].includes(error.code)) {
            errorMessage = 'Invalid username or password.';
        } else {
            errorMessage = "An unexpected error occurred. Please try again.";
        }
      }
      toast({
        variant: 'destructive',
        title: 'Login Failed',
        description: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background to-slate-200">
      <Card className="w-full max-w-sm mx-auto bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Login</CardTitle>
          <CardDescription className="text-center">
            Enter your credentials to access your dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input placeholder="your_username" {...field} />
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
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Logging in...' : 'Login'}
              </Button>
            </form>
          </Form>
          <div className="mt-4 text-center text-sm">
            Don't have an account?{' '}
            <Link href="/signup" className="underline">
              Sign up
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
