import { AuthGuard } from "@/components/role-guard";
import { AppHeader } from "@/components/app-header";

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
        <AppHeader />
        {/* Each page owns its own scroll: Capture/Queue scroll a centered
            column; Review fills the height with two independent panes. */}
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </AuthGuard>
  );
}
