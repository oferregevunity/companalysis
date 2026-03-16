import { useState, useEffect } from 'react';
import { signInWithPopup, signOut as firebaseSignOut, onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { auth, googleProvider, ALLOWED_DOMAIN } from '../lib/firebase';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [domainError, setDomainError] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser && !currentUser.email?.endsWith(`@${ALLOWED_DOMAIN}`)) {
        firebaseSignOut(auth);
        setUser(null);
        setDomainError(true);
      } else {
        setUser(currentUser);
        setDomainError(false);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signIn = async () => {
    try {
      setDomainError(false);
      const result = await signInWithPopup(auth, googleProvider);
      if (!result.user.email?.endsWith(`@${ALLOWED_DOMAIN}`)) {
        await firebaseSignOut(auth);
        setUser(null);
        setDomainError(true);
        return;
      }
    } catch (error) {
      console.error('Sign-in failed:', error);
      throw error;
    }
  };

  const signOutUser = async () => {
    try {
      await firebaseSignOut(auth);
    } catch (error) {
      console.error('Sign-out failed:', error);
      throw error;
    }
  };

  return { user, loading, signIn, signOut: signOutUser, domainError };
}
