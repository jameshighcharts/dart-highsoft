import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { describeSegment, type SpectatorCheckout } from '@/utils/spectatorCheckout';

/** A single route target, styled to match the live board's throw readout colours. */
export function CheckoutChip({ label, index, className }: { label: string; index: number; className?: string }) {
  const { kind, prefix, value } = describeSegment(label);
  return (
    <li
      className={cn('checkout-chip', `checkout-chip--${kind}`, index === 0 && 'checkout-chip--next', className)}
      style={{ animationDelay: `${index * 90}ms` }}
    >
      {prefix ? <span className="checkout-chip-prefix">{prefix}</span> : null}
      <span>{value}</span>
    </li>
  );
}

/** Big, TV-legible finish route shown inside the tile of the player on throw. */
export function CheckoutRoute({
  checkout,
  throws,
  showAlternative = true,
}: {
  checkout: SpectatorCheckout;
  /** This visit's darts; replaces the darts-left count in the header when given. */
  throws?: ReactNode;
  showAlternative?: boolean;
}) {
  if (checkout.kind === 'none') {
    return (
      <div className="checkout-route checkout-route--none" data-kind="none">
        <span className="checkout-route-label">No finish this visit</span>
      </div>
    );
  }

  const primary = checkout.kind === 'checkout' ? checkout.routes[0] : checkout.path;
  const alternative = showAlternative && checkout.kind === 'checkout' ? checkout.routes[1] : undefined;
  const darts = `${checkout.dartsLeft} dart${checkout.dartsLeft === 1 ? '' : 's'}`;
  const ariaLabel = checkout.kind === 'checkout'
    ? `Checkout ${checkout.score}: ${primary.join(', ')}`
    : `Setup: ${primary.join(', ')}, leaving ${checkout.target}`;

  return (
    <div
      key={`${checkout.kind}-${checkout.score}-${primary.join('-')}`}
      className={`checkout-route checkout-route--${checkout.kind}`}
      data-kind={checkout.kind}
      role="group"
      aria-label={ariaLabel}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="checkout-route-label">
          {checkout.kind === 'checkout' ? 'Checkout' : 'Setup'}
        </span>
        {throws ?? <span className="checkout-route-meta">{darts} left</span>}
      </div>
      <ol className="checkout-route-chips">
        {primary.map((label, index) => (
          <CheckoutChip key={`${index}-${label}`} label={label} index={index} />
        ))}
        {checkout.kind === 'setup' ? (
          <li className="checkout-chip checkout-chip--leave" style={{ animationDelay: `${primary.length * 90}ms` }}>
            <span className="checkout-chip-prefix">→</span>
            <span>{checkout.target}</span>
          </li>
        ) : null}
      </ol>
      {alternative ? (
        <div className="checkout-route-alt">
          or <span className="font-bold text-foreground/80">{alternative.join(' · ')}</span>
        </div>
      ) : null}
    </div>
  );
}
