import { AuthGuard } from "@/components/role-guard";
import { AppHeader } from "@/components/app-header";

const NAV_LINKS = [
  { href: "/capture", label: "Capture" },
  { href: "/queue", label: "Print Queue" },
];

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <AppHeader links={NAV_LINKS} />
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </AuthGuard>
  );
}
