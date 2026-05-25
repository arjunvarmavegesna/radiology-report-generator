import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "Radiology Report Generator",
  description: "Ultrasound / radiology report drafting workflow",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* DM Sans / DM Mono, matching the clinic design. Loaded at runtime so
            an offline build still succeeds (fonts degrade to system fonts via
            the --font-sans/--font-mono fallbacks in globals.css). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased">
        <AuthProvider>{children}</AuthProvider>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
