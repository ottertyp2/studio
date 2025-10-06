'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LogOut, Cog, FlaskConical } from 'lucide-react';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { doc } from 'firebase/firestore';
import { useMemoFirebase, useDoc } from '@/firebase';


type UserProfile = {
  email: string;
  createdAt: string;
  isAdmin?: boolean;
}

export default function HubPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const { auth, firestore } = useFirebase();
  const { toast } = useToast();

  const userProfileRef = useMemoFirebase(() => {
    if (!firestore || !user?.uid) return null;
    return doc(firestore, `users/${user.uid}`);
  }, [firestore, user?.uid]);

  const { data: userProfile, isLoading: isUserProfileLoading } = useDoc<UserProfile>(userProfileRef);

  const isAdmin = userProfile?.isAdmin === true;

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  const handleSignOut = () => {
    if (auth) {
      auth.signOut();
      toast({ title: 'Erfolgreich abgemeldet.' });
      router.push('/login');
    }
  };

  if (isUserLoading || isUserProfileLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background to-slate-200">
        <p className="text-lg">Loading user data...</p>
      </div>
    );
  }
  
  if (!user) {
    return null; // or a login prompt
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-background to-slate-200 text-foreground p-4">
      <Card className="w-full max-w-md bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg text-center">
        <CardHeader>
          <CardTitle className="text-3xl bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
            BioThrust Dashboard
          </CardTitle>
          <CardDescription>
            Willkommen, {userProfile?.email || user.uid}. Was möchten Sie tun?
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            size="lg"
            className="w-full justify-start text-lg py-8 btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1"
            onClick={() => router.push('/testing')}
          >
            <FlaskConical className="mr-4 h-6 w-6" />
            Zur Testumgebung
          </Button>

          {isAdmin && (
            <Button
              size="lg"
              variant="secondary"
              className="w-full justify-start text-lg py-8 btn-shine shadow-md transition-transform transform hover:-translate-y-1"
              onClick={() => router.push('/admin')}
            >
              <Cog className="mr-4 h-6 w-6" />
              Zum Admin Panel
            </Button>
          )}

          <Button
            variant="ghost"
            className="w-full justify-center text-muted-foreground mt-6"
            onClick={handleSignOut}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Abmelden
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
