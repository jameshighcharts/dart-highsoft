'use client';

import { Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RealtimeCommentaryStatus } from '@/services/realtimeCommentaryService';

export function CommentaryQuickToggle({ enabled, status, onToggle }: {
  enabled: boolean;
  status: RealtimeCommentaryStatus;
  onToggle: () => void;
}) {
  const live = enabled && status === 'ready';
  const label = !enabled ? 'Turn on commentary and audio with Verse' : 'Turn off commentary and audio';
  const statusLabel = !enabled ? 'Commentary off' : live ? 'Live' : status === 'failed' ? 'Reconnecting' : 'Connecting';

  return (
    <div
      className={`commentary-orb relative isolate rounded-full border bg-background/95 p-1 shadow-sm ${enabled ? live ? 'text-emerald-400 border-emerald-400/40' : 'text-amber-400 border-amber-400/40' : 'text-muted-foreground border-border'}`}
      data-state={!enabled ? 'off' : live ? 'live' : 'connecting'}
    >
      {enabled ? (
        <span className="pointer-events-none absolute inset-0" aria-hidden="true">
          <span className="commentary-halo absolute -inset-2 rounded-full bg-current opacity-20 blur-md" />
          <span className="commentary-ring absolute inset-0 rounded-full border border-current" />
          <span className="commentary-ring commentary-ring-echo absolute inset-0 rounded-full border border-current" />
        </span>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="relative size-11 rounded-full text-inherit hover:bg-current/10 hover:text-inherit"
        aria-label={label}
        aria-pressed={enabled}
        title={`${statusLabel} · ${label}`}
        onClick={onToggle}
      >
        {enabled ? <Volume2 className="size-5" aria-hidden="true" /> : <VolumeX className="size-5" aria-hidden="true" />}
        {enabled ? <span aria-hidden="true" className="absolute bottom-1.5 right-1.5 size-1.5 rounded-full bg-current" /> : null}
      </Button>
      <span role="status" className="sr-only">
        {statusLabel}
      </span>
      <style jsx>{`
        .commentary-orb { transition: color .4s ease, border-color .4s ease; }
        .commentary-ring { animation: commentary-ripple 1.6s ease-out infinite; }
        .commentary-ring-echo { animation-delay: .55s; opacity: 0; }
        .commentary-halo { animation: commentary-breathe 1.6s ease-in-out infinite; }
        [data-state='live'] .commentary-ring { animation-duration: 3.2s; }
        [data-state='live'] .commentary-ring-echo { animation-delay: 1.6s; }
        [data-state='live'] .commentary-halo { animation-duration: 3.2s; }
        @keyframes commentary-ripple {
          0% { transform: scale(.94); opacity: .6; }
          100% { transform: scale(1.35); opacity: 0; }
        }
        @keyframes commentary-breathe {
          0%, 100% { transform: scale(.85); opacity: .12; }
          50% { transform: scale(1.1); opacity: .3; }
        }
        @media (prefers-reduced-motion: reduce) {
          .commentary-orb { transition: none; }
          .commentary-ring { animation: none; opacity: .25; }
          .commentary-ring-echo { display: none; }
          .commentary-halo { animation: none; opacity: .18; }
        }
      `}</style>
    </div>
  );
}
