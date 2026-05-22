"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { roleHome } from "@/lib/roles";
import type { Role } from "@/lib/types";

/**
 * Client-side route guard used by each role's layout. Redirects unauthenticated
 * users to /login and wrong-role users to their own home.
 *
 * NOTE: this is UX-level protection. Real authorization is enforced by the
 * Firestore security rules in firestore.rules.
 */
export function RoleGuard({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  const { user, role: userRole, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
    } else if (userRole !== role) {
      router.replace(roleHome(userRole));
    }
  }, [loading, user, userRole, role, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!user || userRole !== role) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Redirecting…
      </div>
    );
  }
  return <>{children}</>;
}
