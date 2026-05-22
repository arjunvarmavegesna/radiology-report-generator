"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { ROLE_LABELS } from "@/lib/roles";
import { Button } from "@/components/ui/button";

/** Top bar shared by all role areas. Optional nav links per role. */
export function AppHeader({
  links,
}: {
  links?: { href: string; label: string }[];
}) {
  const { user, role, userDoc, signOut } = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-semibold">
            Radiology Reports
          </Link>
          {links && links.length > 0 && (
            <nav className="flex items-center gap-4 text-sm text-muted-foreground">
              {links.map((l) => (
                <Link key={l.href} href={l.href} className="hover:text-foreground">
                  {l.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm">
          {role && (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
              {ROLE_LABELS[role]}
            </span>
          )}
          <span className="text-muted-foreground">
            {userDoc?.name ?? user?.email}
          </span>
          <Button variant="outline" size="sm" onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
