
'use client';

import { ReactNode } from 'react';
import { FirebaseApp } from 'firebase/app';
import { Firestore } from 'firebase/firestore';
import { Auth } from 'firebase/auth';
import { FirebaseStorage } from 'firebase/storage';
import { Database } from 'firebase/database';
import { FirebaseProvider } from './provider';

interface FirebaseClientProviderProps {
  children: ReactNode;
  firebaseApp: FirebaseApp;
  firestore: Firestore;
  auth: Auth;
  storage: FirebaseStorage;
  database: Database;
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
  storage,
  database,
}) => {
  return (
    <FirebaseProvider
      firebaseApp={firebaseApp}
      firestore={firestore}
      auth={auth}
      storage={storage}
      database={database}
    >
      {children}
    </FirebaseProvider>
  );
};
