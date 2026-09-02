'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import type { ThrowRecord, TurnRecord, TurnWithThrows } from '@/lib/match/types';

const SIZE = 500;
const CENTER = SIZE / 2;
const VIEWBOX_INSET = 20;
const NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

type FlashTarget =
  | { kind: 'path'; d: string; intensity: 'single' | 'double' | 'triple' }
  | { kind: 'circle'; radius: number; strokeWidth?: number; intensity: 'double' | 'triple' };

function point(radius: number, angle: number) {
  return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) };
}

function sectorPath(inner: number, outer: number, start: number, end: number) {
  const a = point(inner, start);
  const b = point(outer, start);
  const c = point(outer, end);
  const d = point(inner, end);
  return `M ${a.x} ${a.y} L ${b.x} ${b.y} A ${outer} ${outer} 0 0 1 ${c.x} ${c.y} L ${d.x} ${d.y} A ${inner} ${inner} 0 0 0 ${a.x} ${a.y} Z`;
}

function flashTargetForThrow(dart?: ThrowRecord): FlashTarget | null {
  if (!dart || dart.segment === 'Miss') return null;
  if (dart.segment === 'DB') return { kind: 'circle', radius: 6.35, intensity: 'triple' };
  if (dart.segment === 'SB') {
    return { kind: 'circle', radius: (6.35 + 15.9) / 2, strokeWidth: 15.9 - 6.35, intensity: 'double' };
  }

  const match = dart.segment.match(/^([SDT])(\d+)$/);
  if (!match) return null;
  const multiplier = match[1];
  const number = Number(match[2]);
  const index = NUMBERS.indexOf(number);
  if (index < 0) return null;

  const start = ((index * 18 - 99) * Math.PI) / 180;
  const end = (((index + 1) * 18 - 99) * Math.PI) / 180;
  if (multiplier === 'T') {
    return { kind: 'path', d: sectorPath(99, 107, start, end), intensity: 'triple' };
  }
  if (multiplier === 'D') {
    return { kind: 'path', d: sectorPath(162, 170, start, end), intensity: 'double' };
  }

  const radius = Math.hypot(dart.impact_x_mm ?? 0, dart.impact_y_mm ?? 0);
  const [inner, outer] = radius <= 103 ? [15.9, 99] : [107, 162];
  return { kind: 'path', d: sectorPath(inner, outer, start, end), intensity: 'single' };
}

function ImpactSectionFlash({ dart }: { dart?: ThrowRecord }) {
  const target = flashTargetForThrow(dart);
  if (!dart || !target) return null;

  const className = `segment-flare segment-flare--${target.intensity}`;
  if (target.kind === 'circle') {
    return (
      <g key={dart.id} className={className}>
        <circle className="segment-flare-glow" cx={CENTER} cy={CENTER} r={target.radius} fill={target.strokeWidth ? 'none' : 'currentColor'} stroke={target.strokeWidth ? 'currentColor' : 'none'} strokeWidth={target.strokeWidth} />
        <circle className="segment-flare-core" cx={CENTER} cy={CENTER} r={target.radius} fill={target.strokeWidth ? 'none' : 'currentColor'} stroke={target.strokeWidth ? 'currentColor' : 'none'} strokeWidth={target.strokeWidth} />
      </g>
    );
  }

  return (
    <g key={dart.id} className={className}>
      <path className="segment-flare-glow" d={target.d} fill="currentColor" />
      <path className="segment-flare-core" d={target.d} fill="currentColor" />
    </g>
  );
}

function throwPresentation(segment: string) {
  if (segment === 'DB') {
    return {
      label: 'Bullseye',
      card: 'throw-readout--bull',
      score: 'text-9xl text-amber-100 drop-shadow-[0_0_24px_rgba(251,191,36,1)]',
    };
  }
  if (segment === 'SB') {
    return {
      label: 'Single bull',
      card: 'throw-readout--double throw-readout--outer-bull',
      score: 'text-8xl text-amber-100 drop-shadow-[0_0_20px_rgba(251,191,36,0.9)]',
    };
  }
  if (segment.startsWith('T')) {
    return {
      label: 'Triple',
      card: 'throw-readout--triple',
      score: 'text-9xl text-rose-50 drop-shadow-[0_0_26px_rgba(244,63,94,1)]',
    };
  }
  if (segment.startsWith('D')) {
    return {
      label: 'Double',
      card: 'throw-readout--double',
      score: 'text-8xl text-cyan-50 drop-shadow-[0_0_21px_rgba(34,211,238,0.95)]',
    };
  }
  return {
    label: segment === 'Miss' ? 'Miss' : 'Single',
    card: 'throw-readout--single',
    score: 'text-7xl text-foreground',
  };
}

function ThrowReadout({ dart, index }: { dart?: ThrowRecord; index: number }) {
  if (!dart) {
    return <div className="min-h-36" aria-hidden="true" />;
  }

  const presentation = throwPresentation(dart.segment);
  const segmentMatch = dart.segment.match(/^([SDT])(\d+)$/);
  const multiplier = segmentMatch?.[1] === 'S' ? '' : segmentMatch?.[1] ?? '';
  const target = segmentMatch?.[2]
    ?? dart.segment.toUpperCase();
  return (
    <div
      className={`throw-readout relative flex min-h-36 items-center justify-center overflow-visible ${presentation.card}`}
      style={{ animationDelay: `${index * 70}ms` }}
      aria-label={`Dart ${index + 1}: ${presentation.label} ${dart.segment}, ${dart.scored} points`}
    >
      <div className="throw-aura pointer-events-none absolute -inset-x-14 -inset-y-10 blur-xl" />
      <div className="relative text-center">
        <div className={`throw-score flex items-baseline justify-center font-mono font-black italic leading-none tracking-[-0.11em] ${presentation.score}`}>
          {multiplier ? <span className="mr-1 text-[0.48em] tracking-normal opacity-90">{multiplier}</span> : null}
          <span>{target}</span>
        </div>
      </div>
    </div>
  );
}

export function LiveScoliaBoard({
  turns,
  currentLegId,
  currentPlayerName,
  playerById,
  boardPhase,
}: {
  turns: TurnRecord[];
  currentLegId?: string;
  currentPlayerName?: string;
  playerById?: Record<string, { display_name: string }>;
  boardPhase?: string | null;
}) {
  const latestVisit = useMemo(() => {
    let latest: TurnWithThrows | undefined;
    for (const turn of turns as TurnWithThrows[]) {
      if (turn.leg_id !== currentLegId || !turn.throws?.length) continue;
      if (!latest || turn.turn_number > latest.turn_number) latest = turn;
    }
    return latest;
  }, [turns, currentLegId]);
  const previousBoardPhaseRef = useRef<string | null | undefined>(undefined);
  const [clearedVisitId, setClearedVisitId] = useState<string | null>(null);
  const latestVisitId = latestVisit?.id;
  const latestVisitThrowCount = latestVisit?.throws?.length ?? 0;

  useEffect(() => {
    const previousPhase = previousBoardPhaseRef.current;
    previousBoardPhaseRef.current = boardPhase;

    if (
      previousPhase === 'Takeout'
      && boardPhase === 'Throw'
      && latestVisitId
      && latestVisitThrowCount >= 3
    ) {
      setClearedVisitId(latestVisitId);
    }
  }, [boardPhase, latestVisitId, latestVisitThrowCount]);

  const visitWasTakenOut = clearedVisitId === latestVisitId && latestVisitThrowCount >= 3;
  const currentVisit = visitWasTakenOut ? undefined : latestVisit;
  const currentThrows = useMemo(
    () => [...(currentVisit?.throws ?? [])].sort((a, b) => a.dart_index - b.dart_index),
    [currentVisit]
  );
  const visitTotal = currentThrows.reduce((total, dart) => total + dart.scored, 0);
  const latestDart = currentThrows.at(-1);
  const displayedPlayerName = currentVisit
    ? playerById?.[currentVisit.player_id]?.display_name ?? currentPlayerName
    : currentPlayerName;
  const wedges = useMemo(() => NUMBERS.flatMap((_, index) => {
    const start = ((index * 18 - 99) * Math.PI) / 180;
    const end = (((index + 1) * 18 - 99) * Math.PI) / 180;
    const single = index % 2 === 0 ? '#252525' : '#e7dfcb';
    const ring = index % 2 === 0 ? '#c72f38' : '#238b45';
    return [
      { d: sectorPath(15.9, 99, start, end), fill: single },
      { d: sectorPath(99, 107, start, end), fill: ring },
      { d: sectorPath(107, 162, start, end), fill: single },
      { d: sectorPath(162, 170, start, end), fill: ring },
    ];
  }), []);

  return (
    <Card className="xl:col-span-2 overflow-visible">
      <CardContent className="grid justify-items-center gap-6 py-6 min-[1900px]:min-h-[650px] min-[1900px]:grid-cols-[650px_minmax(0,1fr)] min-[1900px]:items-center min-[1900px]:justify-items-stretch min-[1900px]:py-0">
        <h2 className="sr-only">Live Board</h2>
        <svg
          viewBox={`${VIEWBOX_INSET} ${VIEWBOX_INSET} ${SIZE - VIEWBOX_INSET * 2} ${SIZE - VIEWBOX_INSET * 2}`}
          className="aspect-square w-full max-w-[650px] shrink-0 drop-shadow-xl"
          role="img"
          aria-label="Live Scolia dartboard"
        >
          <defs>
            <filter id="impact-glow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
          </defs>
          <g key={`board-${latestDart?.id ?? 'idle'}`} className={latestDart ? `board-impact board-impact--${flashTargetForThrow(latestDart)?.intensity ?? 'single'}` : undefined}>
            <circle cx={CENTER} cy={CENTER} r="220" fill="#101010" />
            <circle cx={CENTER} cy={CENTER} r="174" fill="#191919" stroke="#050505" strokeWidth="7" />
            {wedges.map((wedge, index) => <path key={index} d={wedge.d} fill={wedge.fill} stroke="#111" strokeWidth="0.8" />)}
            <circle cx={CENTER} cy={CENTER} r="15.9" fill="#238b45" />
            <circle cx={CENTER} cy={CENTER} r="6.35" fill="#c72f38" />
            {NUMBERS.map((number, index) => {
              const position = point(198, ((index * 18 - 90) * Math.PI) / 180);
              return <text key={number} x={position.x} y={position.y} fill="white" fontSize="18" fontWeight="700" textAnchor="middle" dominantBaseline="middle">{number}</text>;
            })}
          </g>
          <ImpactSectionFlash dart={latestDart} />
          {(currentVisit?.throws ?? []).map((dart) => {
            if (dart.impact_x_mm == null || dart.impact_y_mm == null) return null;
            const x = CENTER + dart.impact_x_mm;
            // Scolia uses positive Y above center; SVG uses positive Y downward.
            const y = CENTER - dart.impact_y_mm;
            const horizontalAngle = dart.angle_horizontal_deg ?? 0;
            const verticalAngle = dart.angle_vertical_deg ?? 0;
            return (
              <g key={dart.id} className="live-dart" style={{ transformOrigin: `${x}px ${y}px` }}>
                <title>{`${dart.segment} · x ${dart.impact_x_mm}mm · y ${dart.impact_y_mm}mm · horizontal ${horizontalAngle}° · vertical ${verticalAngle}°`}</title>
                <circle className="impact-flash" cx={x} cy={y} r="22" fill="#e0f2fe" filter="url(#impact-glow)" />
                <circle className="impact-wave impact-wave-primary" cx={x} cy={y} r="8" fill="none" stroke="#f0f9ff" strokeWidth="3.5" />
                <circle className="impact-wave impact-wave-secondary" cx={x} cy={y} r="8" fill="none" stroke="#38bdf8" strokeWidth="2" />
                <circle cx={x} cy={y} r="14" fill="#38bdf8" opacity="0.32" filter="url(#impact-glow)" />
                <circle className="impact-ring" cx={x} cy={y} r="10" fill="none" stroke="#7dd3fc" strokeWidth="1.5" />
                <g className="impact-core" style={{ transformOrigin: `${x}px ${y}px` }}>
                  <circle cx={x} cy={y} r="5" fill="#020617" stroke="#f8fafc" strokeWidth="2.5" />
                  <circle cx={x} cy={y} r="1.8" fill="#38bdf8" />
                </g>
              </g>
            );
          })}
          <style>{`
            .live-dart { animation: dart-land .44s cubic-bezier(.16,.86,.25,1.2); transform-box: view-box; }
            .board-impact { animation: board-impact .42s cubic-bezier(.12,.82,.2,1) both; transform-box: view-box; transform-origin: center; }
            .board-impact--double { animation-name: board-impact-double; }
            .board-impact--triple { animation-name: board-impact-triple; }
            .segment-flare { color: #fde68a; }
            .segment-flare--double { color: #67e8f9; }
            .segment-flare--triple { color: #fb7185; }
            .segment-flare-glow { animation: segment-flare-glow .62s cubic-bezier(.08,.72,.18,1) both; filter: url(#impact-glow); }
            .segment-flare-core { animation: segment-flare-core .46s cubic-bezier(.08,.72,.18,1) both; }
            .segment-flare--double .segment-flare-glow,
            .segment-flare--double .segment-flare-core { animation-duration: .72s; }
            .segment-flare--triple .segment-flare-glow,
            .segment-flare--triple .segment-flare-core { animation-duration: .84s; }
            .impact-flash { animation: impact-flash .5s ease-out both; transform-box: fill-box; transform-origin: center; }
            .impact-wave { animation: impact-wave .7s cubic-bezier(.1,.7,.2,1) both; transform-box: fill-box; transform-origin: center; }
            .impact-wave-secondary { animation-delay: .07s; }
            .impact-core { animation: impact-core .45s cubic-bezier(.15,.9,.2,1.3) both; transform-box: view-box; }
            .impact-ring { animation: impact-pulse 1.8s ease-out infinite; transform-box: fill-box; transform-origin: center; }
            @keyframes dart-land {
              0% { opacity: 0; transform: scale(1.45); filter: brightness(3); }
              55% { opacity: 1; transform: scale(.97); filter: brightness(1.7); }
              100% { opacity: 1; transform: scale(1); filter: brightness(1); }
            }
            @keyframes board-impact {
              0% { transform: scale(1.018); filter: brightness(2.2) contrast(1.3); }
              28% { transform: scale(.988); filter: brightness(.72) contrast(1.5); }
              55% { transform: scale(1.006); filter: brightness(1.28); }
              100% { transform: scale(1); filter: brightness(1); }
            }
            @keyframes board-impact-double {
              0% { transform: scale(1.035) rotate(.28deg); filter: brightness(3.2) contrast(1.45); }
              25% { transform: scale(.978) rotate(-.18deg); filter: brightness(.62) contrast(1.7); }
              52% { transform: scale(1.012) rotate(.08deg); filter: brightness(1.55); }
              100% { transform: scale(1) rotate(0); filter: brightness(1); }
            }
            @keyframes board-impact-triple {
              0% { transform: scale(1.055) rotate(.45deg); filter: brightness(4.3) contrast(1.6); }
              18% { transform: scale(.965) rotate(-.32deg); filter: brightness(.48) contrast(2); }
              38% { transform: scale(1.022) rotate(.16deg); filter: brightness(1.9); }
              60% { transform: scale(.994) rotate(-.06deg); }
              100% { transform: scale(1) rotate(0); filter: brightness(1); }
            }
            @keyframes segment-flare-glow {
              0% { opacity: 1; filter: url(#impact-glow) brightness(5); }
              22% { opacity: .96; }
              58% { opacity: .42; filter: url(#impact-glow) brightness(2); }
              100% { opacity: 0; filter: url(#impact-glow) brightness(1); }
            }
            @keyframes segment-flare-core {
              0% { opacity: 1; filter: brightness(8) saturate(.3); }
              18% { opacity: .92; filter: brightness(4) saturate(1.7); }
              52% { opacity: .32; }
              100% { opacity: 0; filter: brightness(1); }
            }
            @keyframes impact-flash { 0% { opacity: 1; transform: scale(.2); } 45% { opacity: .85; } 100% { opacity: 0; transform: scale(2.6); } }
            @keyframes impact-wave { 0% { opacity: 1; transform: scale(.35); stroke-width: 5; } 100% { opacity: 0; transform: scale(4.2); stroke-width: .5; } }
            @keyframes impact-core { 0% { transform: scale(3.4); opacity: 0; } 55% { transform: scale(.68); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
            @keyframes impact-pulse { 0%, 45% { opacity: .9; transform: scale(.75); } 100% { opacity: 0; transform: scale(1.7); } }
            @media (prefers-reduced-motion: reduce) {
              .live-dart, .impact-core, .board-impact { animation: none; }
              .segment-flare { opacity: .28; }
              .segment-flare-glow, .segment-flare-core { animation: none; }
              .impact-flash, .impact-wave, .impact-ring { display: none; }
            }
          `}</style>
        </svg>
        <div
          key={visitWasTakenOut ? `next-${clearedVisitId}-${currentPlayerName}` : `visit-${currentVisit?.id ?? 'empty'}`}
          className={`relative flex w-full flex-col justify-center min-[1900px]:min-h-[600px] ${visitWasTakenOut ? 'next-player-stage' : ''}`}
          aria-label="Current visit throws"
        >
          {displayedPlayerName ? (
            <div className="mb-3 text-center" aria-live="polite">
              <div className="text-[10px] font-black uppercase tracking-[0.42em] text-cyan-500/70 sm:text-xs">
                Current player
              </div>
              <div className="mt-1 bg-gradient-to-r from-cyan-300 via-white to-sky-400 bg-clip-text text-4xl font-black uppercase italic leading-none tracking-[-0.04em] text-transparent drop-shadow-[0_0_18px_rgba(56,189,248,0.32)] sm:text-5xl min-[1900px]:text-6xl">
                {displayedPlayerName}
              </div>
            </div>
          ) : (
            <div className="mb-3 text-center text-sm font-bold uppercase tracking-[0.3em] text-muted-foreground">
              Waiting for player
            </div>
          )}
          <div className="throw-readout-grid grid grid-cols-1 gap-3 sm:grid-cols-3" role="list">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={currentThrows[index]?.id ?? `empty-${index}`} role="listitem">
                <ThrowReadout dart={currentThrows[index]} index={index} />
              </div>
            ))}
          </div>
          {currentThrows.length > 0 ? (
            <div key={`${currentVisit?.id}-${visitTotal}`} className="visit-total mt-1 flex items-baseline justify-center gap-3 font-mono font-black italic text-white/85">
              <span className="text-2xl text-white/25">=</span>
              <span className="text-5xl tracking-[-0.08em]">{visitTotal}</span>
            </div>
          ) : null}
        </div>
      </CardContent>
      <style jsx global>{`
        .throw-readout {
          animation: throw-enter .52s cubic-bezier(.12,.9,.2,1.25) both;
        }
        .throw-readout--double {
          animation-name: double-enter;
        }
        .throw-readout--triple {
          animation-name: triple-enter;
        }
        .throw-readout--bull {
          animation-name: triple-enter;
        }
        .throw-readout--outer-bull .throw-aura {
          background: radial-gradient(circle, rgba(251, 191, 36, .2), rgba(251, 191, 36, 0) 72%);
        }
        .throw-readout--double .throw-aura {
          background: radial-gradient(circle, rgba(34, 211, 238, .2), rgba(34, 211, 238, 0) 72%);
        }
        .throw-readout--triple .throw-aura {
          background: radial-gradient(circle, rgba(244, 63, 94, .3), rgba(244, 63, 94, 0) 74%);
        }
        .throw-readout--bull .throw-aura {
          background: radial-gradient(circle, rgba(251, 191, 36, .3), rgba(251, 191, 36, 0) 74%);
        }
        .visit-total {
          animation: total-enter .4s cubic-bezier(.12,.9,.2,1.2) both;
        }
        .next-player-stage {
          animation: next-player-enter .72s cubic-bezier(.12,.9,.2,1.18) both;
        }
        .next-player-stage::before {
          position: absolute;
          inset: 8% -10%;
          content: '';
          pointer-events: none;
          background: radial-gradient(circle, rgba(34, 211, 238, .3), rgba(34, 211, 238, 0) 68%);
          animation: next-player-flash .8s ease-out both;
        }
        @keyframes throw-enter {
          0% { opacity: 0; transform: translateX(42px) scale(.88); filter: brightness(2); }
          65% { opacity: 1; transform: translateX(-3px) scale(1.02); }
          100% { opacity: 1; transform: translateX(0) scale(1); filter: brightness(1); }
        }
        @keyframes double-enter {
          0% { opacity: 0; transform: translateX(58px) scale(1.18) skewX(-7deg); filter: brightness(3); }
          58% { opacity: 1; transform: translateX(-5px) scale(.97) skewX(1deg); }
          100% { opacity: 1; transform: translateX(0) scale(1) skewX(0); filter: brightness(1); }
        }
        @keyframes triple-enter {
          0% { opacity: 0; transform: translateX(76px) scale(1.42) skewX(-10deg); filter: brightness(4); }
          52% { opacity: 1; transform: translateX(-8px) scale(.94) skewX(2deg); }
          76% { transform: translateX(3px) scale(1.035) skewX(-1deg); }
          100% { opacity: 1; transform: translateX(0) scale(1) skewX(0); filter: brightness(1); }
        }
        @keyframes total-enter {
          0% { opacity: 0; transform: translateY(-10px) scale(1.45); filter: brightness(2.5); }
          65% { opacity: 1; transform: translateY(2px) scale(.95); }
          100% { transform: translateY(0) scale(1); filter: brightness(1); }
        }
        @keyframes next-player-enter {
          0% { opacity: 0; transform: translateX(90px) scale(1.25) skewX(-9deg); filter: brightness(3); }
          58% { opacity: 1; transform: translateX(-8px) scale(.96) skewX(2deg); }
          78% { transform: translateX(3px) scale(1.025) skewX(-1deg); }
          100% { opacity: 1; transform: translateX(0) scale(1) skewX(0); filter: brightness(1); }
        }
        @keyframes next-player-flash {
          0% { opacity: 0; transform: scale(.3); }
          30% { opacity: 1; }
          100% { opacity: 0; transform: scale(1.6); }
        }
        @media (prefers-reduced-motion: reduce) {
          .throw-readout, .visit-total, .next-player-stage, .next-player-stage::before { animation: none; }
        }
        @media (min-width: 1900px) {
          .throw-readout-grid { grid-template-columns: minmax(0, 1fr); }
        }
      `}</style>
    </Card>
  );
}
