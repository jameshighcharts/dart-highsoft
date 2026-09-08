"use client";

import { Portal as TooltipPortal } from '@radix-ui/react-tooltip';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function gameDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const colors = ['bg-muted', 'bg-green-200 dark:bg-green-950', 'bg-green-400 dark:bg-green-800', 'bg-green-600', 'bg-green-800 dark:bg-green-400'];

export function GameActivityHeatmap({ dates, selectedDate, onSelectDate }: {
  dates: string[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - 364);
  start.setDate(start.getDate() - start.getDay());
  const counts = new Map<string, number>();
  for (const timestamp of dates) {
    const date = new Date(timestamp);
    if (date < start || date >= new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)) continue;
    const key = gameDateKey(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const weeks: Date[][] = [];
  for (const day = new Date(start); day <= today;) {
    const week: Date[] = [];
    for (let weekday = 0; weekday < 7; weekday++) {
      week.push(new Date(day));
      day.setDate(day.getDate() + 1);
    }
    weeks.push(week);
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return <TooltipProvider delayDuration={150}><Card>
    <CardHeader>
      <CardTitle>Game activity</CardTitle>
      <CardDescription>{total} {total === 1 ? 'game' : 'games'} in the past year · Games started per day · Click a day to filter</CardDescription>
    </CardHeader>
    <CardContent>
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max gap-1">
          <div className="grid grid-rows-[20px_repeat(7,12px)] gap-1 pr-2 text-[10px] text-muted-foreground" aria-hidden="true">
            <span /><span /><span>Mon</span><span /><span>Wed</span><span /><span>Fri</span><span />
          </div>
          {weeks.map((week, index) => <div key={index} className="grid grid-rows-[20px_repeat(7,12px)] gap-1">
            <span className="relative text-[10px] text-muted-foreground" aria-hidden="true">
              {week.some(date => date.getDate() === 1) ? <span className="absolute">{week.find(date => date.getDate() === 1)?.toLocaleDateString(undefined, { month: 'short' })}</span> : null}
            </span>
            {week.map(date => {
              const key = gameDateKey(date);
              const count = counts.get(key) ?? 0;
              const label = `${date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}: ${count} ${count === 1 ? 'game' : 'games'}`;
              return date > today ? <span key={key} className="h-3 w-3" /> : <Tooltip key={key}>
                <TooltipTrigger asChild><button
                type="button" aria-label={label} aria-pressed={selectedDate === key}
                onClick={() => onSelectDate(key)}
                className={`h-3 w-3 rounded-[2px] border border-foreground/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${colors[Math.min(count, 4)]} ${selectedDate === key ? 'ring-2 ring-foreground ring-offset-1 ring-offset-background' : ''}`}
              /></TooltipTrigger>
                <TooltipPortal><TooltipContent>{label}</TooltipContent></TooltipPortal>
              </Tooltip>;
            })}
          </div>)}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
        <span>Less</span>{colors.map((color, index) => <span key={color} title={index === 4 ? '4+ games' : `${index} games`} className={`h-3 w-3 rounded-[2px] ${color}`} />)}<span>More</span>
      </div>
    </CardContent>
  </Card></TooltipProvider>;
}
