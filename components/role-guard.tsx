"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

/**
 * Client-side guard for the workspace. Redirects unauthenticated users to
 * /login. Role is no longer checked — this is a single-role app, every
 * signed-in user sees the same Capture → Review → Queue workspace.
 *
 * UX-level protection only. Real authorization is enforced by firestore.rules
 * and the API routes (verifyIdToken).
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Redirecting…
      </div>
    );
  }
  return <>{children}</>;
}

// Back-compat re-export — older route files import `RoleGuard`. They're being
// deleted in this change, but keeping the alias avoids a compile error if any
// were missed.
export const RoleGuard = AuthGuard;
