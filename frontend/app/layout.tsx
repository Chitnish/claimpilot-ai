import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { AppShell } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import "./globals.css";

// One font everywhere: Geist for all UI text. Geist Mono is the same type
// family, reserved only for IDs / code microtext.
const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "ClaimPilot AI",
  description: "Multi-agent healthcare claims automation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  return (
    <html
      lang="en"
      className={cn("dark font-sans", geist.variable, geistMono.variable)}
    >
      <body className="min-h-screen antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
