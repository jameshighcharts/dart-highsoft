'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, RotateCw, Tv } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

const COMPASS_TV_URL = 'https://compass.highsoftlabs.com/tv';

export function CompassTvButton() {
  const [open, setOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const active = useRef(false);
  const ownsFullscreen = useRef(false);

  function releaseFullscreen() {
    if (ownsFullscreen.current && document.fullscreenElement === document.documentElement) {
      void document.exitFullscreen().catch(() => {});
    }
    ownsFullscreen.current = false;
  }

  useEffect(() => () => {
    active.current = false;
    releaseFullscreen();
  }, []);

  function changeOpen(nextOpen: boolean) {
    active.current = nextOpen;
    setOpen(nextOpen);
    if (!nextOpen) {
      releaseFullscreen();
      return;
    }
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      void document.documentElement.requestFullscreen().then(() => {
        ownsFullscreen.current = true;
        if (!active.current) releaseFullscreen();
      }).catch(() => {});
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Tv className="size-4" />Compass TV</Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="inset-0 z-[100] h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-black p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">Compass TV slideshow</DialogTitle>
        <iframe
          key={reload}
          src={COMPASS_TV_URL}
          title="Compass TV slideshow"
          allow="fullscreen"
          allowFullScreen
          className="h-full w-full border-0"
        />
        <div className="absolute right-3 top-3 flex items-center gap-2 rounded-lg bg-background/95 p-2 shadow-lg">
          <Button size="sm" variant="outline" asChild>
            <a href={COMPASS_TV_URL} target="_blank" rel="noopener noreferrer" aria-label="Open Compass" title="Open Compass to sign in or watch in a separate tab">
              <ExternalLink className="size-4" /><span className="hidden sm:inline">Open Compass</span>
            </a>
          </Button>
          <Button size="sm" variant="outline" onClick={() => setReload(value => value + 1)} aria-label="Reload slideshow">
            <RotateCw className="size-4" />
          </Button>
          <Button size="sm" onClick={() => changeOpen(false)}><ArrowLeft className="size-4" />Back to darts</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
