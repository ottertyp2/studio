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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useFirebase } from '@/firebase';
import { FirebaseError } from 'firebase/app';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';


export default function SignupPage() {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const { auth, firestore } = useFirebase();
  const { toast } = useToast();

  const form = useForm({
    defaultValues: {
      email: '',
      password: '',
      isAdmin: false,
      masterPassword: '',
    },
  });

  const isAdminValue = form.watch('isAdmin');

  const onSubmit = async (values: any) => {
    if (!values.email || !values.password) {
        toast({
            variant: 'destructive',
            title: 'Sign Up Failed',
            description: 'Please enter both username and password.',
        });
        return;
    }
    if (values.isAdmin && !values.masterPassword) {
        toast({
            variant: 'destructive',
            title: 'Sign Up Failed',
            description: 'Master password is required to create an admin account.',
        });
        return;
    }

    setIsLoading(true);

    if (values.isAdmin && values.masterPassword !== process.env.NEXT_PUBLIC_ADMIN_MASTER_PASSWORD) {
      toast({
        variant: 'destructive',
        title: 'Sign Up Failed',
        description: 'The master password is incorrect.',
      });
      setIsLoading(false);
      return;
    }

    try {
      if (!auth || !firestore) throw new Error('Auth or Firestore service not available');

      const finalUsername = values.email.includes('@') ? values.email : `${values.email}@biothrust.local`;

      const userCredential = await createUserWithEmailAndPassword(auth, finalUsername, values.password);
      const user = userCredential.user;

      const userProfileRef = doc(firestore, 'users', user.uid);

      await setDoc(userProfileRef, {
        email: values.email, // Store the original username
        createdAt: new Date().toISOString(),
        isAdmin: values.isAdmin,
      });

      toast({
        title: 'Account Created',
        description: "You've been successfully signed up and logged in.",
      });
      router.push('/');
    } catch (error) {
      let errorMessage = 'An unexpected error occurred.';
      if (error instanceof FirebaseError) {
        switch (error.code) {
          case 'auth/email-already-in-use':
            errorMessage = 'This username is already taken.';
            break;
          case 'auth/weak-password':
            errorMessage = 'Password is too weak. Please use at least 6 characters.';
            break;
          case 'auth/invalid-email':
            errorMessage = 'The username is not valid. Please try a different one.';
            break;
          default:
            errorMessage = "Could not create account. Please try again.";
            break;
        }
      }
      toast({
        variant: 'destructive',
        title: 'Sign Up Failed',
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
          <CardTitle className="text-2xl text-center">Create an Account</CardTitle>
          <CardDescription className="text-center">
            Enter your username and password to get started.
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
                      <Input placeholder="Choose a username" {...field} />
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
                    <FormDescription>
                      Password must be at least 6 characters long.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isAdmin"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Create as Admin</FormLabel>
                    </div>
                  </FormItem>
                )}
              />
              {isAdminValue && (
                <FormField
                  control={form.control}
                  name="masterPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Master Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Enter master password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Creating Account...' : 'Sign Up'}
              </Button>
            </form>
          </Form>
          <div className="mt-4 text-center text-sm">
            Already have an account?{' '}
            <Link href="/login" className="underline">
              Login
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
