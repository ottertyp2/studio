
'use client';

import { ReactNode } from 'react';
import { FirebaseApp } from 'firebase/app';
import { Firestore } from 'firebase/firestore';
import { Auth } from 'firebase/auth';
import { FirebaseProvider } from './provider';

interface FirebaseClientProviderProps {
  children: ReactNode;
  firebaseApp: FirebaseApp;
  firestore: Firestore;
  auth: Auth;
}

/**
 * Ensures Firebase services are provided only on the client-side.
 * It composes the main FirebaseProvider.
 */
export const FirebaseClientProvider: React.FC<FirebaseClientProviderProps> = ({
  children,
  firebaseApp,
  firestore,
  auth,
}) => {
  return (
    <FirebaseProvider
      firebaseApp={firebaseApp}
      firestore={firestore}
      auth={auth}
    >
      {children}
    </FirebaseProvider>
  );
};
