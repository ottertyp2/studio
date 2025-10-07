
'use client';
import {
  Auth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  User,
} from 'firebase/auth';
import { doc, setDoc, getDocs, collection, query, where, Firestore } from 'firebase/firestore';
import { errorEmitter } from './error-emitter';
import { FirestorePermissionError } from './errors';

/** Initiate email/password sign-up (non-blocking). */
export async function initiateEmailSignUp(authInstance: Auth, firestore: Firestore, email: string, password: string, username?: string): Promise<void> {
  // Check if username already exists, if provided and is not an empty string
  if (username && username.trim() !== '') {
    const usernameQuery = query(collection(firestore, 'users'), where('username', '==', username));
    const usernameSnapshot = await getDocs(usernameQuery);
    if (!usernameSnapshot.empty) {
      throw new Error('Username already exists.');
    }
  }

  try {
    const userCredential = await createUserWithEmailAndPassword(authInstance, email, password);
    const user = userCredential.user;
    const userDocRef = doc(firestore, 'users', user.uid);
    const userData = {
      email: user.email,
      username: username || '',
      role: 'user' // Default role
    };

    // Use a non-blocking setDoc and catch potential permission errors
    setDoc(userDocRef, userData).catch(error => {
      const permissionError = new FirestorePermissionError({
        path: `users/${user.uid}`,
        operation: 'create',
        requestResourceData: userData,
      });
      errorEmitter.emit('permission-error', permissionError);
      // We still want to inform the user about this, even if it's non-blocking for the UI
      console.error("Firestore error during user creation:", permissionError.message);
    });

  } catch (error: any) {
    // Re-throw auth errors to be handled by the UI
    throw error;
  }
}

/** Initiate email/password or username/password sign-in (non-blocking). */
export async function initiateEmailSignIn(authInstance: Auth, firestore: Firestore, emailOrUsername: string, password: string): Promise<User> {
  let email = emailOrUsername;

  // If the input doesn't look like an email, assume it's a username and find the email
  if (!emailOrUsername.includes('@')) {
    const username = emailOrUsername;
    const q = query(collection(firestore, 'users'), where('username', '==', username));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      throw new Error('User not found.');
    }
    
    // Assuming usernames are unique, take the first result
    const userDoc = querySnapshot.docs[0];
    email = userDoc.data().email;

    if (!email) {
        throw new Error('Could not find email associated with username.');
    }
  }

  try {
    const userCredential = await signInWithEmailAndPassword(authInstance, email, password);
    return userCredential.user;
  } catch (error) {
    console.error("Sign in error:", error);
    throw error;
  }
}


/** Initiate sign out (non-blocking). */
export function signOut(authInstance: Auth): void {
  firebaseSignOut(authInstance).catch(error => {
    console.error("Sign out error:", error);
  });
}
