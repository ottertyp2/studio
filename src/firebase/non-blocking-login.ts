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
  } else {
    username = emailOrUsername;
    email = `${username}@${DUMMY_DOMAIN}`;
  }

  // Check if username already exists
  const usernameQuery = query(collection(firestore, 'users'), where('username', '==', username));
  try {
    const querySnapshot = await getDocs(usernameQuery);
    if (!querySnapshot.empty) {
      throw new Error('This username is already taken. Please choose another one.');
    }
  } catch (e: any) {
     // If the query fails due to permissions, we have a bigger problem.
     // For now, we surface a generic error.
    throw new Error(`[E1] Could not verify username availability. Please check security rules. Original error: ${e.message}`);
  }


  let user: User;
  try {
    const userCredential = await createUserWithEmailAndPassword(authInstance, email, password);
    user = userCredential.user;
    // Force a token refresh to ensure the client is fully authenticated before the Firestore write.
    await user.getIdToken(true);
  } catch (authError: any) {
    if (authError.code === 'auth/email-already-in-use') {
        throw new Error('[E4] This username is already taken as it maps to an existing email. Please choose another one.');
    }
    throw new Error(`[E4] Firebase Auth account creation failed: ${authError.message}`);
  }
  
  const userDocRef = doc(firestore, 'users', user.uid);
  const userData = {
    id: user.uid,
    email: user.email,
    username: username,
    role: 'user'
  };

  try {
    await setDoc(userDocRef, userData);
  } catch (firestoreError: any) {
    const permissionError = new FirestorePermissionError({
      path: userDocRef.path,
      operation: 'create',
      requestResourceData: userData,
    });
    errorEmitter.emit('permission-error', permissionError);
    throw new Error(`[E5] User profile creation failed. Original error: ${permissionError.message}`);
  }
}

/** Initiate email/password or username/password sign-in (non-blocking). */
export async function initiateEmailSignIn(authInstance: Auth, firestore: Firestore, emailOrUsername: string, password: string): Promise<User> {
  let email = emailOrUsername;

  if (!emailOrUsername.includes('@')) {
    const username = emailOrUsername;
    const q = query(collection(firestore, 'users'), where('username', '==', username));
    try {
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
          throw new Error('User not found.');
        }
        
        const userDoc = querySnapshot.docs[0];
        email = userDoc.data().email;

        if (!email) {
            throw new Error('Could not find email associated with username.');
        }
    } catch (e) {
        console.error("Error fetching user by username", e);
        // Fallback to trying as email anyway, maybe it was a username that looked like an email but wasn't
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
