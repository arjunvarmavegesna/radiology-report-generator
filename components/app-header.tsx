"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  getReviewQueue,
  getApprovedCases,
  getSentBackQueue,
} from "@/lib/cases";
import {
  PERSONAS,
  loadPersona,
  savePersona,
  personaHome,
  type Persona,
} from "@/lib/persona";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/capture", label: "Capture & Generate", badge: "sentback" },
  { href: "/review", label: "Radiologist Review", badge: "review" },
  { href: "/queue", label: "Print Queue", badge: "ready" },
] as const;

/** Clinic-style top bar: solid blue bar (logo + role switcher + sign out) over
 *  a tab strip with live count badges. The role switcher is a non-gating
 *  persona selector — switching just jumps to that role's home tab. */
export function AppHeader() {
  const { user, userDoc, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [persona, setPersona] = useState<Persona>("typist");
  const [reviewCount, setReviewCount] = useState(0);
  const [readyCount, setReadyCount] = useState(0);
  const [sentBackCount, setSentBackCount] = useState(0);

  useEffect(() => {
    setPersona(loadPersona());
  }, []);

  // Refresh tab counts on every route change. Cheap for a small clinic; keeps
  // the Review / Print badges in sync as cases move through the pipeline.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [rev, app, sb] = await Promise.all([
          getReviewQueue(),
          getApprovedCases(),
          getSentBackQueue(),
        ]);
        if (!active) return;
        setReviewCount(rev.length);
        setReadyCount(app.filter((c) => !c.printedAt).length);
        setSentBackCount(sb.length);
      } catch {
        /* badge counts are best-effort */
      }
    })();
    return () => {
      active = false;
    };
  }, [pathname]);

  function onPersona(p: Persona) {
    setPersona(p);
    savePersona(p);
    router.push(personaHome(p));
  }

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <header className="flex-shrink-0">
      {/* Blue bar */}
      <div className="flex h-[52px] items-center justify-between bg-primary px-4 text-primary-foreground shadow-[0_2px_6px_rgba(0,0,0,0.2)]">
        <Link
          href="/capture"
          className="flex items-center gap-2.5 text-[13px] font-semibold"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-white/20 text-sm">
            R
          </span>
          Radiology Reports
        </Link>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5">
            <span className="opacity-80">Role:</span>
            <select
              value={persona}
              onChange={(e) => onPersona(e.target.value as Persona)}
              className="cursor-pointer border-none bg-transparent text-xs font-medium text-white outline-none"
              aria-label="Switch role"
            >
              {PERSONAS.map((p) => (
                <option key={p.value} value={p.value} className="text-black">
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <span className="hidden opacity-90 sm:inline">
            {userDoc?.name ?? user?.email}
          </span>
          <button
            onClick={handleSignOut}
            className="rounded-md bg-white/15 px-2.5 py-1 font-medium transition-colors hover:bg-white/25"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Tab strip */}
      <nav className="flex overflow-x-auto border-b border-border bg-card px-4">
        {TABS.map((t) => {
          const active = isActive(t.href);
          const count =
            t.badge === "review"
              ? reviewCount
              : t.badge === "ready"
                ? readyCount
                : t.badge === "sentback"
                  ? sentBackCount
                  : 0;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "-mb-px flex items-center whitespace-nowrap border-b-2 px-3.5 py-3 text-xs font-medium transition-colors",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {t.badge && count > 0 && (
                <span
                  className={cn(
                    "ml-1.5 rounded-[10px] px-1.5 py-px text-[10px] font-bold text-white",
                    t.badge === "review"
                      ? "bg-[#D97706]"
                      : t.badge === "sentback"
                        ? "bg-[#7F1D1D]"
                        : "bg-primary",
                  )}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
