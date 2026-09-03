import type { Metadata } from "next";
import Image from "next/image";
import "./globals.css";
import Link from "next/link";
import { Grid3x3, Target, BarChart3, Plus, Radio, Trophy, Users } from "lucide-react";
import { Analytics } from "@vercel/analytics/react";
import { MatchSpectatorHotkey } from "@/components/MatchSpectatorHotkey";
import { QueryProvider } from "@/components/QueryProvider";

// Use system fonts as fallback when Google Fonts cannot be loaded during build
const fontVariables = 'font-sans';

export const metadata: Metadata = {
  title: "Dart Highsoft - Dart Scoring App",
  description: "A modern, real-time dart scoring application for competitive matches and practice sessions",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
      { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" }
    ],
    apple: { url: "/apple-icon.png", sizes: "180x180", type: "image/png" }
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Dart Highsoft"
  },
  formatDetection: {
    telephone: false
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full" suppressHydrationWarning>
      <body
        className={`${fontVariables} antialiased min-h-screen h-full bg-background text-foreground`}
      >
        <QueryProvider>
        <div className="min-h-screen pb-16 lg:pb-0">
          <nav className="hidden lg:flex items-center justify-between px-6 py-3 border-b bg-card">
            <Link href="/" className="flex items-center gap-3 font-semibold">
              <Image src="/icon-192x192.png" alt="" width={40} height={40} className="size-10 object-contain" priority />
              Highsoft Dart Scoreboard
            </Link>
            <div className="flex items-center gap-4 text-sm">
              <Link href="/new" className="flex items-center gap-2">
                <Plus className="size-4" />
                New match
              </Link>
              <Link href="/" className="flex items-center gap-2">
                <Grid3x3 className="size-4" />
                The Grid
              </Link>
              <Link href="/games" className="flex items-center gap-2">
                <Target className="size-4" />
                Games
              </Link>
              <Link href="/players" className="flex items-center gap-2">
                <Users className="size-4" />
                Players
              </Link>
              <Link href="/leaderboards" className="flex items-center gap-2">
                <Trophy className="size-4" />
                Leaderboards
              </Link>
              <Link href="/boards" className="flex items-center gap-2">
                <Radio className="size-4" />
                Boards
              </Link>
              <Link href="/stats" className="flex items-center gap-2">
                <BarChart3 className="size-4" />
                Statistics
              </Link>
            </div>
          </nav>
          <main className="px-3 py-2 md:p-6">{children}</main>
          <nav className="lg:hidden fixed bottom-0 left-0 right-0 border-t bg-card">
            <div className="grid grid-cols-5">
              <Link href="/" className="flex flex-col items-center justify-center py-2 gap-1">
                <Grid3x3 className="size-5" />
                <span className="text-xs">The Grid</span>
              </Link>
              <Link href="/games" className="flex flex-col items-center justify-center py-2 gap-1">
                <Target className="size-5" />
                <span className="text-xs">Games</span>
              </Link>
              <Link href="/players" className="flex flex-col items-center justify-center py-2 gap-1">
                <Users className="size-5" />
                <span className="text-xs">Players</span>
              </Link>
              <Link href="/boards" className="flex flex-col items-center justify-center py-2 gap-1">
                <Radio className="size-5" />
                <span className="text-xs">Boards</span>
              </Link>
              <Link href="/stats" className="flex flex-col items-center justify-center py-2 gap-1">
                <BarChart3 className="size-5" />
                <span className="text-xs">Stats</span>
              </Link>
            </div>
          </nav>
        </div>
        </QueryProvider>
        <Analytics />
        <MatchSpectatorHotkey />
      </body>
    </html>
  );
}
