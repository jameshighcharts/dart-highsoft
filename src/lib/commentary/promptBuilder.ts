import type { CommentaryPersona, CommentaryPayload, MatchRecapPayload } from './types';
import { computeDartIQ, humorStyleFromScore } from './insights';

interface PromptBuildOptions {
  persona: CommentaryPersona;
  random?: () => number;
}

export interface PromptBuildResult {
  prompt?: string;
  plainLine?: string;
  allowSlang: boolean;
  humorStyle: ReturnType<typeof humorStyleFromScore>;
}

export function buildCommentaryPrompt(
  payload: CommentaryPayload,
  options: PromptBuildOptions
): PromptBuildResult {
  const { persona } = options;
  const rng = options.random ?? Math.random;
  const style = persona.style;
  const significantPressure = Boolean(
    payload.pressure
      && (Math.abs(payload.pressure.matchWpa) >= 0.06
        || (payload.pressure.peakMatchConsequence ?? 0) >= 0.04
        || (payload.pressure.peakLegConsequence ?? 0) >= 0.08
        || payload.pressure.createdBogey
        || payload.pressure.changedMatchFavorite
        || payload.pressure.checkedOut)
  );
  const hasNarrativeHook = Boolean(
    payload.narrative
      && (
        payload.narrative.rematch
        || payload.narrative.activeStoryArc
        || Math.abs(payload.narrative.biggestSwing?.matchWpa ?? 0) >= 0.05
        || payload.narrative.players.some((player) =>
          player.tendencies.length > 0
          || player.baselinePerformance !== 'near_baseline'
          || player.checkoutPressure.recentMissedDoubles.length > 0
          || player.checkoutPressure.highPressureOpportunities > 0
        )
      )
  );

  if (
    persona.id !== 'chad'
    &&
    !payload.isNikitaSpecial
    && !significantPressure
    && !hasNarrativeHook
    && rng() < style.plainLineProbability
  ) {
    return {
      plainLine: `${payload.playerName} scores ${payload.totalScore}; ${payload.remainingScore} left.`,
      allowSlang: false,
      humorStyle: humorStyleFromScore(payload.totalScore),
    };
  }

  const { gameContext } = payload;
  const throwsDescription = payload.throws
    .map((t, i) => `Dart ${i + 1}: ${t.segment} (${t.scored})`)
    .join(', ');

  const recentTurnsStr = gameContext.playerRecentTurns
    .map((t) => (t.busted ? 'BUST' : t.score))
    .join(', ');

  const standingsStr = gameContext.allPlayers
    .slice()
    .sort((a, b) => a.remainingScore - b.remainingScore)
    .map((p) => `${p.name}: ${p.remainingScore} (avg ${p.average.toFixed(1)})`)
    .join(' | ');

  let resultPrefix = '';
  if (payload.isNikitaSpecial) {
    resultPrefix = 'NIKITA SPECIAL: exactly 1 + 5 + 20! Treat this as a beloved absurd marquee event. ';
  } else if (payload.busted) {
    resultPrefix = 'BUST! ';
  } else if (payload.is180) {
    resultPrefix = '180! ';
  } else if (payload.isHighScore) {
    resultPrefix = `${payload.totalScore}! `;
  }

  const streakInfo = gameContext.consecutiveHighScores
    ? ` HOT: ${gameContext.consecutiveHighScores} in a row.`
    : gameContext.consecutiveLowScores
      ? ` COLD: ${gameContext.consecutiveLowScores} in a row.`
      : '';

  const iq = computeDartIQ({
    remainingScore: payload.remainingScore,
    totalScore: payload.totalScore,
    busted: payload.busted,
    dartsUsedThisTurn: gameContext.dartsUsedThisTurn,
  });

  const iqHints: string[] = [];
  if (iq.isBogey) iqHints.push(`${payload.remainingScore} is a bogey leave.`);
  if (iq.inCheckout && !iq.isBogey) iqHints.push('Checkout range (≤170).');
  if (iq.onDouble) iqHints.push(`Sitting on double ${payload.remainingScore / 2}.`);
  else if (iq.twoDart) iqHints.push(`${payload.remainingScore} is a two-dart finish.`);
  if (iq.maxOut) iqHints.push('170 checkout is live.');
  if (iq.setupShot) iqHints.push('Visit looked like a setup shot.');
  if (iq.bust) iqHints.push(`Bust resets to ${payload.remainingScore}.`);

  const pressureHints: string[] = [];
  if (payload.pressure) {
    const pressure = payload.pressure;
    const formatPercent = (value: number) => `${Math.round(value * 100)}%`;
    const formatPoints = (value: number) => `${value >= 0 ? '+' : ''}${Math.round(value * 100)}pp`;
    pressureHints.push(
      `Match win chance ${formatPercent(pressure.matchProbabilityBefore)} → ${formatPercent(pressure.matchProbabilityAfter)} (${formatPoints(pressure.matchWpa)}).`
    );
    pressureHints.push(
      `Leg win chance ${formatPercent(pressure.legProbabilityBefore)} → ${formatPercent(pressure.legProbabilityAfter)} (${formatPoints(pressure.legWpa)}).`
    );
    if (pressure.changedMatchFavorite) pressureHints.push('This visit changed the match favorite.');
    if (Math.abs(pressure.biggestDartMatchWpa) >= 0.03) {
      pressureHints.push(`Biggest single-dart match swing in the visit: ${formatPoints(pressure.biggestDartMatchWpa)}.`);
    }
    if ((pressure.peakMatchConsequence ?? 0) >= 0.03) {
      pressureHints.push(`Largest full-field match consequence: ${formatPoints(pressure.peakMatchConsequence ?? 0)}.`);
    }
    if (pressure.createdBogey) pressureHints.push('The visit created an unfinishable bogey leave.');
    else if (
      pressure.setupGrade
      && pressure.setupGrade !== 'checkout'
      && pressure.setupGrade !== 'bust'
    ) {
      pressureHints.push(
        `Setup quality: ${pressure.setupGrade} (${Math.round((pressure.setupQuality ?? 0) * 100)}/100); next-visit checkout chance ${formatPercent(pressure.nextVisitCheckoutProbability ?? 0)}.`
      );
    }
  }

  const narrativeMemory = payload.narrative
    ? JSON.stringify(payload.narrative)
    : 'none yet';

  const allowSlang = persona.id === 'chad' || rng() < style.slangUseProbability;
  const humorStyle = humorStyleFromScore(payload.totalScore);

  const ordinalPosition = formatOrdinal(gameContext.positionInMatch);
  const positionLine = `Position: ${ordinalPosition} place${gameContext.isLeading ? ' (leading)' : ` (${gameContext.pointsBehindLeader} behind)`}.`;

  const slangTermLabel = style.maxSlangPerLine === 1 ? 'term' : 'terms';

  const deliveryDirection = persona.id === 'chad'
    ? `Write ONE concise, deadpan line (≤ ${style.maxWords} words) in Chad's original California surf-bro voice.`
    : `Write ONE concise line (≤ ${style.maxWords} words).`;

  const prompt = `
${payload.playerName}: ${throwsDescription} = ${payload.totalScore} pts. ${resultPrefix}${payload.remainingScore} left.
${positionLine}
Recent: ${recentTurnsStr || 'First turn'}.${streakInfo}
Standings: ${standingsStr || 'No standings available.'}

IQ hints: ${iqHints.length ? iqHints.join(' ') : 'none'}
Pressure Engine: ${pressureHints.length ? pressureHints.join(' ') : 'no pressure data'}
Compact narrative memory: ${narrativeMemory}
Special event: ${payload.isNikitaSpecial ? 'Nikita special — celebrate the exact 1, 5, 20 visit by name.' : 'none'}

${deliveryDirection}
Use ${payload.playerName}'s name and reference their ${payload.totalScore}-point turn or current checkout situation.
Keep it playful and lightly sassy. Tease the darts or the emerging story, never the person's identity or appearance.

Humor style: ${humorStyle}.
Tone guide:
- hype-lite: impressed but calm
- confident-dry: composed credit
- neutral-dry: matter-of-fact
- roast-lite: gentle ribbing, not mean
- wry-quiet: minimal, resigned humor

Slang policy: ${persona.id === 'chad'
    ? 'let the persona and the moment decide naturally; do not follow a numeric slang quota.'
    : allowSlang ? `optional (≤${style.maxSlangPerLine} natural ${slangTermLabel}).` : 'avoid all slang this line.'}
Stay clear of hashtags, emojis, or filler catchphrases.
Prioritize dart intelligence (bogeys, checkout pressure, doubles, busts, setup leaves) over jokes.
When Pressure Engine data is present, explain the consequence accurately. Pressure is the situation; call the result clutch only when the player gained probability.
Use at most one relevant narrative-memory thread. Build continuity without reciting the memory object or forcing history into every call.
When broadcastDirection is present, follow its activeStoryArc as the committed angle, ignore backgroundStoryArcs, and honor payoff_due or closure_due callbacks. Otherwise use activeStoryArc. Never invent evidence beyond it.
Be informative first, witty second. Output only the one-liner.`;

  return { prompt, allowSlang, humorStyle };
}

function formatOrdinal(value: number): string {
  const absValue = Math.abs(value);
  const remainder = absValue % 100;
  if (remainder >= 11 && remainder <= 13) {
    return `${value}th`;
  }
  switch (absValue % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

export function buildMatchRecapPrompt(
  payload: MatchRecapPayload
): PromptBuildResult {
  const { context } = payload;

  const finalStandings = context.allPlayers
    .slice()
    .sort((a, b) => b.legsWon - a.legsWon || a.remainingScore - b.remainingScore)
    .map((p, idx) => `${idx + 1}. ${p.name} (${p.legsWon} legs, avg ${p.average.toFixed(1)})`)
    .join('\n');

  const checkoutInfo = context.winningLeg?.checkoutScore
    ? `${context.winnerName} closed it with a ${context.winningLeg.checkoutScore} checkout.`
    : '';

  const finalThrowsInfo = context.winningLeg?.finalThrows
    ? `Final darts: ${context.winningLeg.finalThrows.map(t => t.segment).join(', ')}.`
    : '';

  const matchStats = `
Match: ${context.startScore} start, best of ${context.legsToWin * 2 - 1} legs.
Winner: ${context.winnerName} wins ${context.winnerLegsWon}-${context.totalLegs - context.winnerLegsWon}.
${checkoutInfo}
${finalThrowsInfo}

Final Standings:
${finalStandings}
${context.matchDuration ? `Duration: ${context.matchDuration}` : ''}
`.trim();

  const prompt = `
${matchStats}

MATCH ENDED. Write an enthusiastic, entertaining match recap and winner announcement.

Requirements:
- 2-4 sentences total (60-80 words max)
- Lead with the winner's name and celebration
- Highlight a key moment or stat from the match
- Reference the final score
- End with excitement about the victory
- Use your persona's style but dial up the energy for this special moment

This is the BIG finale - make it memorable! Output the recap only.`;

  return {
    prompt,
    allowSlang: true,
    humorStyle: 'hype-lite' as ReturnType<typeof humorStyleFromScore>
  };
}
