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
import { useToast } from '@/hooks/use-toast';
import { useFirebase, setDocumentNonBlocking } from '@/firebase';
import { FirebaseError } from 'firebase/app';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDocs, collection } from 'firebase/firestore';


export default function SignupPage() {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const { auth, firestore } = useFirebase();
  const { toast } = useToast();

  const form = useForm({
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (values: any) => {
    if (!values.email || !values.password) {
        toast({
            variant: 'destructive',
            title: 'Sign Up Failed',
            description: 'Please enter both username and password.',
        });
        return;
    }
    
    setIsLoading(true);

    try {
      if (!auth || !firestore) throw new Error('Auth or Firestore service not available');

      // Check if any users exist to determine if this is the first user
      const usersCollectionRef = collection(firestore, 'users');
      const existingUsersSnapshot = await getDocs(usersCollectionRef);
      const isFirstUser = existingUsersSnapshot.empty;

      // Append dummy domain if it's not an email format
      const finalUsername = values.email.includes('@') ? values.email : `${values.email}@biothrust.local`;

      const userCredential = await createUserWithEmailAndPassword(auth, finalUsername, values.password);
      const user = userCredential.user;

      const userProfileRef = doc(firestore, 'users', user.uid);
      
      // The non-blocking call is safe here because it's a 'create' operation
      // for a new user, and the security rules should permit users to create their own profile.
      setDocumentNonBlocking(userProfileRef, {
        email: values.email, // Store the original username
        createdAt: new Date().toISOString(),
        // Make the very first user an admin by default.
        isAdmin: isFirstUser,
      }, { merge: false });

      toast({
        title: isFirstUser ? 'Admin Account Created' : 'Account Created',
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
            The first user to sign up will be the administrator.
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
