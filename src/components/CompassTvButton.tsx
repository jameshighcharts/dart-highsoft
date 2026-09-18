import { Tv } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function CompassTvButton() {
  return (
    <Button variant="outline" asChild>
      <a href="https://compass.highsoftlabs.com/tv"><Tv className="size-4" />Compass TV</a>
    </Button>
  );
}
