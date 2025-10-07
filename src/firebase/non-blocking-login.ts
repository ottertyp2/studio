
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

const DUMMY_DOMAIN = 'biothrust.app';

/** Initiate sign-up with email or username (non-blocking). */
export async function initiateEmailSignUp(authInstance: Auth, firestore: Firestore, emailOrUsername: string, password: string): Promise<void> {
  let email: string;
  let username: string;

  if (emailOrUsername.includes('@')) {
    email = emailOrUsername;
    username = email.split('@')[0];
    const usernameQuery = query(collection(firestore, 'users'), where('username', '==', username));
    const usernameSnapshot = await getDocs(usernameQuery);
    if (!usernameSnapshot.empty) {
      throw new Error(`The username '${username}' derived from your email is already taken. Please try signing up with a unique username instead.`);
    }
  } else {
    username = emailOrUsername;
    email = `${username}@${DUMMY_DOMAIN}`;
    const usernameQuery = query(collection(firestore, 'users'), where('username', '==', username));
    const usernameSnapshot = await getDocs(usernameQuery);
    if (!usernameSnapshot.empty) {
      throw new Error('Username already exists.');
    }
  }

  let user: User;
  try {
    const userCredential = await createUserWithEmailAndPassword(authInstance, email, password);
    user = userCredential.user;
  } catch (authError: any) {
    if (authError.code === 'auth/email-already-in-use') {
        throw new Error('This username is already taken as it maps to an existing email. Please choose another one.');
    }
    throw authError; // Re-throw other auth errors
  }
  
  const userDocRef = doc(firestore, 'users', user.uid);
  const userData = {
    email: user.email,
    username: username,
    role: 'user'
  };

  try {
    // Await setDoc to catch its specific errors
    await setDoc(userDocRef, userData);
  } catch (firestoreError: any) {
    // Create and emit a detailed, contextual error for better debugging
    const permissionError = new FirestorePermissionError({
      path: userDocRef.path,
      operation: 'create',
      requestResourceData: userData,
    });
    errorEmitter.emit('permission-error', permissionError);
    // Also, re-throw the permission error so the UI can know the operation failed.
    throw permissionError;
  }
}

/** Initiate email/password or username/password sign-in (non-blocking). */
export async function initiateEmailSignIn(authInstance: Auth, firestore: Firestore, emailOrUsername: string, password: string): Promise<User> {
  let email = emailOrUsername;

  if (!emailOrUsername.includes('@')) {
    const username = emailOrUsername;
    const q = query(collection(firestore, 'users'), where('username', '==', username));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      throw new Error('User not found.');
    }
    
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
