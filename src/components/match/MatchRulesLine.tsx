import type { FinishRule } from '@/utils/x01';

type Props = {
  finishRule: FinishRule;
  fairEnding?: boolean;
  className?: string;
};

/** Minimal one-line summary of the match rules (finish rule + fair ending). */
export function MatchRulesLine({ finishRule, fairEnding, className = '' }: Props) {
  return (
    <div
      className={`text-[10px] leading-none uppercase tracking-wide text-muted-foreground/70 ${className}`}
      data-testid="match-rules-line"
    >
      {finishRule === 'double_out' ? 'Double out' : 'Single out'}
      <span className="mx-1">·</span>
      Fair ending {fairEnding ? 'on' : 'off'}
    </div>
  );
}
