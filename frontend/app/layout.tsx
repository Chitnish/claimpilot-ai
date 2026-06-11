import type { Metadata } from "next";
import localFont from "next/font/local";
import { Geist } from "next/font/google";

import { AppSidebar } from "@/components/app-sidebar";
import { cn } from "@/lib/utils";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

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
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen antialiased`}
      >
        <div className="flex min-h-screen">
          <AppSidebar />
          <main className="flex-1 overflow-auto bg-muted/20">{children}</main>
        </div>
      </body>
    </html>
  );
}
