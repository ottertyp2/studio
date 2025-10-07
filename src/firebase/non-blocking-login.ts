'use client';
import {
  Auth, 
  signInAnonymously,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  User,
} from 'firebase/auth';
import { doc, setDoc, Firestore } from 'firebase/firestore';
import { errorEmitter } from './error-emitter';
import { FirestorePermissionError } from './errors';

/** Initiate email/password sign-up (non-blocking). */
export function initiateEmailSignUp(authInstance: Auth, firestore: Firestore, email: string, password: string): void {
  createUserWithEmailAndPassword(authInstance, email, password)
    .then(userCredential => {
      // Create user document in Firestore
      const user = userCredential.user;
      const userDocRef = doc(firestore, 'users', user.uid);
      const userData = {
        email: user.email,
        role: 'user' // Default role
      };

      setDoc(userDocRef, userData)
        .catch(error => {
          // This catch block is specifically for the setDoc operation.
          const permissionError = new FirestorePermissionError({
            path: userDocRef.path,
            operation: 'create',
            requestResourceData: userData,
          });
          errorEmitter.emit('permission-error', permissionError);
          console.error("Firestore user creation error:", error); // Keep original error log for server
        });
    })
    .catch(error => {
      // This catch block is for createUserWithEmailAndPassword.
      // We let the UI handle this via the form's error state.
      console.error("Sign up authentication error:", error);
      // Re-throw to be caught by the form's onSubmit handler
      throw error;
    });
}

/** Initiate email/password sign-in (non-blocking). */
export function initiateEmailSignIn(authInstance: Auth, email: string, password: string): Promise<User> {
  return signInWithEmailAndPassword(authInstance, email, password)
    .then(userCredential => userCredential.user)
    .catch(error => {
      console.error("Sign in error:", error);
      throw error;
    });
}

/** Initiate sign out (non-blocking). */
export function signOut(authInstance: Auth): void {
  firebaseSignOut(authInstance).catch(error => {
    console.error("Sign out error:", error);
  });
}
