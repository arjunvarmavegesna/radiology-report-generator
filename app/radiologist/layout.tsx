import { RoleGuard } from "@/components/role-guard";
import { AppHeader } from "@/components/app-header";

export default function RadiologistLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard role="radiologist">
      <AppHeader links={[{ href: "/radiologist/new", label: "New Case" }, { href: "/radiologist/cases", label: "My Cases" }]} />
      <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">{children}</main>
    </RoleGuard>
  );
}
