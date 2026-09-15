'use client';
import { BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

const stages = [
  ['Group stage', '301', 'Straight out'],
  ['Play-off', '301', 'Straight out'],
  ['Quarterfinal + semifinal', '301', 'Double out'],
  ['Final', '501', 'Double out'],
];
const steps = [
  [
    'Office group stage',
    'Each registered player is randomly drawn into 5 matches against other registered players from the same office. Gjertrud and Sindre each play 6 because their offices have an odd number of players. They choose one match to exclude from their own wins, losses, legs and average, leaving 5 counting matches. That match still counts for their opponent. Choices can change until the finals draw is locked. Wins form the office table; the top four advance. Ties only matter for 4th place.',
  ],
  [
    'Four byes to the quarterfinal',
    'The three office winners, 1st at Vik, Bergen and Sogndal, plus the best of the three 2nd-place finishers, decided by average. The 2nd place with the best average gets the fourth bye.',
  ],
  [
    'Play-off: eight players, four spots',
    'The other two 2nd places, all three 3rd places and all three 4th places. Winners advance. Nobody plays someone from their own office. The two 2nd places each face a 4th place; one 3rd place faces the remaining 4th place; the two remaining 3rd places face each other.',
  ],
  [
    'Quarterfinal, semifinal, final',
    'Four bye players + four play-off winners → semifinal with four players → final with two. The bracket is arranged so same-office players meet as late as possible, typically not before the semifinal or final. If an office has two bye players they are placed in opposite halves.',
  ],
];
export function HighdartsRules() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          aria-label="Rules"
          className="size-8 shrink-0 gap-2 p-0 sm:h-9 sm:w-auto sm:px-3"
        >
          <BookOpen className="size-4" />
          <span className="hidden sm:inline">Rules</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Rules</DialogTitle>
          <DialogDescription>
            Highdarts 2026 · Three offices. Twelve finalists.
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Match format</caption>
            <thead className="bg-muted">
              <tr>
                {['Stage', 'Start', 'Finish', 'Legs'].map((h) => (
                  <th key={h} className="p-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stages.map(([stage, start, finish]) => (
                <tr key={stage} className="border-t">
                  <th className="p-3 font-medium">{stage}</th>
                  <td className="p-3">{start}</td>
                  <td className="p-3">{finish}</td>
                  <td className="whitespace-nowrap p-3">Best of 3</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {steps.map(([title, body], i) => (
          <section key={title} className="rounded-xl border bg-muted/30 p-4">
            <h3 className="mb-2 font-semibold">
              <span className="mr-2 text-cyan-300">{i}</span> {title}
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {body}
            </p>
          </section>
        ))}
        <section className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-4">
          <h3 className="mb-2 font-semibold text-amber-200">
            In case of a tie
          </h3>
          <p className="text-sm leading-relaxed">
            A tie, equal wins / average, only matters for 4th place or between
            2nd-place finishers for the fourth bye. In both cases a single
            play-off match, in the same format as the current stage, decides
            placement.
          </p>
        </section>
      </DialogContent>
    </Dialog>
  );
}
