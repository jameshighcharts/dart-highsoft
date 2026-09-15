'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTG5Lq8S38mHqDldWQo8MiIsTE88U68yiVx5iwToQaObcpqtzwNJzs1G1Pl2eXvzUxu-wogyh0fBAsw/pubhtml?widget=true&headers=false';

export function HighdartsSheet() {
  const [refreshToken, setRefreshToken] = useState(() => Date.now());
  const refresh = () => setRefreshToken((token) => Math.max(token + 1, Date.now()));

  useEffect(() => {
    const refreshVisibleSheet = () => {
      if (document.visibilityState === 'visible') {
        setRefreshToken((token) => Math.max(token + 1, Date.now()));
      }
    };
    const timer = window.setInterval(refreshVisibleSheet, 60_000);
    document.addEventListener('visibilitychange', refreshVisibleSheet);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisibleSheet);
    };
  }, []);

  return (
    <section className="rounded-2xl border border-white/10 bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <a
          href="https://docs.google.com/spreadsheets/d/1gIbV9OM3RsItTwQQPgwQjAxwOfPsfaPLRA08RXqsp_c/edit"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-200"
        >
          Open in Google Sheets <ArrowUpRight className="size-4" />
        </a>
        <Button type="button" variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="size-4" /> Refresh sheet
        </Button>
      </div>
      <p className="my-3 text-sm text-muted-foreground">
        Results sync every five minutes. This view refreshes every minute while
        open. Google may take a few more minutes to publish changes.
      </p>
      <iframe
        src={`${SHEET_URL}&refresh=${refreshToken}`}
        title="Highdarts 2026 Google Sheet"
        loading="lazy"
        className="min-h-[70vh] w-full rounded-xl border bg-white [filter:invert(0.9)_hue-rotate(180deg)]"
      />
    </section>
  );
}
