"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import type { Role, UserDoc } from "./types";

interface AuthState {
  user: User | null;
  role: Role | null;
  userDoc: UserDoc | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setUser(null);
        setRole(null);
        setUserDoc(null);
        setLoading(false);
        return;
      }
      setUser(u);
      try {
        // Source of truth for role is the custom claim; fall back to the
        // users/{uid} document so the app is testable before claims are set.
        const token = await u.getIdTokenResult();
        let resolvedRole = (token.claims.role as Role | undefined) ?? null;

        let resolvedDoc: UserDoc | null = null;
        const snap = await getDoc(doc(db, "users", u.uid));
        if (snap.exists()) {
          resolvedDoc = snap.data() as UserDoc;
          if (!resolvedRole) resolvedRole = resolvedDoc.role;
        }

        setUserDoc(resolvedDoc);
        setRole(resolvedRole);
      } catch (err) {
        console.error("Failed to resolve user role:", err);
        setRole(null);
        setUserDoc(null);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  const signOut = async () => {
    await fbSignOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, role, userDoc, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
