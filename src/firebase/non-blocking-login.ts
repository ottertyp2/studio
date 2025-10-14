
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
      // This is a normal application error, not a security/permission error.
      // We throw it directly to be caught by the calling component.
      throw new Error('This username is already taken. Please choose another one.');
    }
  } catch (e: any) {
     // This catch block is now only for actual Firestore query failures (e.g., permissions).
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
        // Since we check for username, this implies a username maps to a real email that's already registered.
        throw new Error('This username is already taken as it maps to an existing email. Please choose another one.');
    }
    // For other auth errors (weak password, etc.)
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
    // This error will be thrown to the Next.js overlay for the developer to debug security rules.
    throw new Error(`[E5] User profile creation failed. Original error: ${permissionError.message}`);
  }
}

/** Initiate email/password or username/password sign-in (non-blocking). */
export async function initiateEmailSignIn(authInstance: Auth, firestore: Firestore, emailOrUsername: string, password: string): Promise<User> {
  let email = emailOrUsername;
  console.log("SIGNIN CALLED", email, password);

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

/** Admin function to create a new user with both Auth and Firestore records. */
export async function adminCreateUser(authInstance: Auth, firestore: Firestore, username: string, password: string, role: 'user' | 'superadmin'): Promise<void> {
  const email = `${username}@${DUMMY_DOMAIN}`;

  // 1. Check if username already exists in Firestore
  const usernameQuery = query(collection(firestore, 'users'), where('username', '==', username));
  const usernameSnapshot = await getDocs(usernameQuery);
  if (!usernameSnapshot.empty) {
    throw new Error(`Username "${username}" is already taken.`);
  }

  // This is a temporary admin-only flow, so we don't create a separate auth instance.
  // In a real multi-admin app, you'd use the Admin SDK on a backend.
  // For this Studio environment, we create the user with the currently logged-in admin's client instance.
  // This can have implications if auth state is shared, but is acceptable for this tool's architecture.

  let userCredential;
  try {
    // 2. Create the user in Firebase Authentication
    userCredential = await createUserWithEmailAndPassword(authInstance, email, password);
  } catch (authError: any) {
    // Re-throw auth errors to be displayed in the UI
    throw new Error(`Firebase Auth error: ${authError.message}`);
  }

  const user = userCredential.user;
  const userDocRef = doc(firestore, 'users', user.uid);
  const userProfile = {
    id: user.uid,
    username: username,
    email: email,
    role: role,
  };

  try {
    // 3. Create the user profile document in Firestore
    await setDoc(userDocRef, userProfile);
  } catch (firestoreError: any) {
    // If Firestore write fails, we should ideally delete the created auth user for cleanup.
    // This is complex on the client-side. For now, we'll just report the error.
    const permissionError = new FirestorePermissionError({
        path: userDocRef.path,
        operation: 'create',
        requestResourceData: userProfile,
    });
    errorEmitter.emit('permission-error', permissionError);
    throw new Error(`User auth account was created, but Firestore profile creation failed. ${permissionError.message}`);
  }
}
