import { cn } from '@/lib/utils';

/**
 * A loading placeholder that stays invisible for its first 150ms and then fades in (the
 * `.loading-reveal` animation), so cached data and quick responses replace it before it is seen.
 * It still reserves the layout from the first frame, so nothing jumps when the content arrives.
 * `label` is announced to screen readers.
 */
export function LoadingReveal({
  label,
  className,
  children,
  as: Element = 'div',
}: {
  label: string;
  className?: string;
  children?: React.ReactNode;
  as?: 'div' | 'li' | 'main';
}) {
  return (
    <Element role="status" aria-busy="true" className={cn('loading-reveal', className)}>
      <span className="sr-only">{label}</span>
      {children}
    </Element>
  );
}
