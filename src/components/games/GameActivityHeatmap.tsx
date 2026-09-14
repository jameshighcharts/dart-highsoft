"use client";

import { Portal as TooltipPortal } from '@radix-ui/react-tooltip';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function gameDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Sequential scale: level 0 = no games, levels 1-6 scale relative to the busiest day.
const colors = [
  'bg-muted',
  'bg-green-100 dark:bg-green-900',
  'bg-green-200 dark:bg-green-800',
  'bg-green-400 dark:bg-green-700',
  'bg-green-500 dark:bg-green-600',
  'bg-green-700 dark:bg-green-400',
  'bg-green-900 dark:bg-green-200',
];
const maxLevel = colors.length - 1;

/** Map a day's count to a color level relative to the busiest day, so a 13-game day is always darker than a 4-game day. */
export function activityLevel(count: number, max: number) {
  if (count <= 0) return 0;
  if (max <= 1) return maxLevel;
  return Math.max(1, Math.ceil((count / max) * maxLevel));
}

/** Legend thresholds: the smallest count that maps to each non-zero level. */
export function activityThresholds(max: number) {
  const thresholds: number[] = [];
  for (let level = 1; level <= maxLevel; level++) {
    let count = 1;
    while (count < max && activityLevel(count, max) < level) count++;
    thresholds.push(count);
  }
  return thresholds;
}

export function GameActivityHeatmap({ dates, selectedDate, onSelectDate }: {
  dates: string[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(2026, 8, 1);
  const firstWeek = new Date(start);
  firstWeek.setDate(firstWeek.getDate() - (firstWeek.getDay() + 6) % 7);
  const counts = new Map<string, number>();
  for (const timestamp of dates) {
    const date = new Date(timestamp);
    if (date < start || date >= new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)) continue;
    const key = gameDateKey(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const weeks: Date[][] = [];
  for (const day = new Date(firstWeek); day <= today;) {
    const week: Date[] = [];
    for (let weekday = 0; weekday < 7; weekday++) {
      week.push(new Date(day));
      day.setDate(day.getDate() + 1);
    }
    weeks.push(week);
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const max = Math.max(0, ...counts.values());
  const thresholds = activityThresholds(max);
  return <TooltipProvider delayDuration={150}><Card>
    <CardHeader>
      <CardTitle>Game activity</CardTitle>
      <CardDescription>{total} {total === 1 ? 'game' : 'games'} since September 2026 · Games started per day · Click a day to filter</CardDescription>
    </CardHeader>
    <CardContent>
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max gap-1">
          <div className="grid grid-rows-[20px_repeat(7,12px)] gap-1 pr-2 text-right text-[10px] leading-3 text-muted-foreground" aria-hidden="true">
            <span /><span>Mon</span><span /><span>Wed</span><span /><span>Fri</span><span /><span />
          </div>
          {weeks.map((week, index) => <div key={index} className="grid grid-rows-[20px_repeat(7,12px)] gap-1">
            <span className="relative text-[10px] text-muted-foreground" aria-hidden="true">
              {week.some(date => date.getDate() === 1) ? <span className="absolute">{week.find(date => date.getDate() === 1)?.toLocaleDateString(undefined, { month: 'short' })}</span> : null}
            </span>
            {week.map(date => {
              const key = gameDateKey(date);
              const count = counts.get(key) ?? 0;
              const label = `${date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}: ${count} ${count === 1 ? 'game' : 'games'}`;
              return date < start || date > today ? <span key={key} className="h-3 w-3" /> : <Tooltip key={key}>
                <TooltipTrigger asChild><button
                type="button" aria-label={label} aria-pressed={selectedDate === key}
                onClick={() => onSelectDate(key)}
                className={`h-3 w-3 rounded-[2px] border border-foreground/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${colors[activityLevel(count, max)]} ${selectedDate === key ? 'ring-2 ring-foreground ring-offset-1 ring-offset-background' : ''}`}
              /></TooltipTrigger>
                <TooltipPortal><TooltipContent>{label}</TooltipContent></TooltipPortal>
              </Tooltip>;
            })}
          </div>)}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
        <span>Less</span>{colors.map((color, index) => {
          const from = index === 0 ? 0 : thresholds[index - 1];
          const to = index === 0 ? 0 : index === maxLevel ? max : thresholds[index] - 1;
          const title = index === 0 ? 'No games' : to <= from ? `${from} ${from === 1 ? 'game' : 'games'}` : `${from}–${to} games`;
          return <span key={color} title={title} className={`h-3 w-3 rounded-[2px] border border-foreground/10 ${color}`} />;
        })}<span>More{max > 0 ? ` (${max})` : ''}</span>
      </div>
    </CardContent>
  </Card></TooltipProvider>;
}
