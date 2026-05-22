import { RoleGuard } from "@/components/role-guard";
import { AppHeader } from "@/components/app-header";

export default function ReviewerLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard role="reviewer">
      <AppHeader links={[{ href: "/reviewer/queue", label: "Review Queue" }]} />
      <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">{children}</main>
    </RoleGuard>
  );
}
