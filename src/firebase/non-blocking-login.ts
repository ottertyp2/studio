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

/** Initiate email/password sign-up (non-blocking). */
export function initiateEmailSignUp(authInstance: Auth, firestore: Firestore, email: string, password: string): void {
  createUserWithEmailAndPassword(authInstance, email, password)
    .then(userCredential => {
      // Create user document in Firestore
      const user = userCredential.user;
      const userDocRef = doc(firestore, 'users', user.uid);
      setDoc(userDocRef, {
        email: user.email,
        role: 'user' // Default role
      });
    })
    .catch(error => {
      // Let onAuthStateChanged handle the error state if needed
      console.error("Sign up error:", error);
    });
}

/** Initiate email/password sign-in (non-blocking). */
export function initiateEmailSignIn(authInstance: Auth, email: string, password: string): void {
  signInWithEmailAndPassword(authInstance, email, password);
}

/** Initiate sign out (non-blocking). */
export function signOut(authInstance: Auth): void {
  firebaseSignOut(authInstance);
}
