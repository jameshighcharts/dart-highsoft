import type { BroadcastDirection } from './broadcastDirector';
import { describe, expect, it } from 'vitest';

import { realtimePersonaResponseInstruction, resolvePersona } from './personas';
import {
  buildRealtimeVisitOpeningInstructions,
  buildRealtimeIdleInstructions,
  buildRealtimeOpeningInstructions,
  buildRealtimeResponseInstructions,
  buildRealtimeSessionInstructions,
  realtimeResponseMessages,
  realtimeLengthInstruction,
  realtimeTextureInstruction,
} from './realtimePrompt';

describe('Realtime commentary prompts', () => {
  it('makes the Nikita Special an explosive named celebration with extra room', () => {
    const prompt = buildRealtimeResponseInstructions({
      personaId: 'chad', priority: 'marquee', dartIndex: 3, turnScore: 26,
      checkedOut: false, busted: false, nikitaSpecial: true, nextPlayerAlreadyThrowing: false,
    });
    expect(prompt).toContain('mandatory cult-classic celebration');
    expect(prompt).toContain('6–16 words');
    expect(prompt).toContain('signature-move hysteria');
    expect(prompt).toContain('no stock catchphrase');
  });
  it('gives an explicitly selected historical connection enough room without changing short reactions', () => {
    const input = {
      personaId: 'chad' as const, priority: 'notable' as const, dartIndex: 3, turnScore: 60,
      checkedOut: false, busted: false, nextPlayerAlreadyThrowing: false,
    };
    const focused = buildRealtimeResponseInstructions({ ...input, historicalFocus: true });
    expect(focused).toContain('DELIVERY · 6–12 words');
    expect(focused).toContain('HISTORY · Make the supplied personal comparison or shared history the point');
    const ordinary = buildRealtimeResponseInstructions({ ...input, dartIndex: 1 });
    expect(ordinary).toContain('DELIVERY · 0–2 words');
    expect(ordinary).not.toContain('HISTORY ·');
  });

  it.each(['chad', 'bob'] as const)('preserves the full %s contract in every response override', (personaId) => {
    const contract = buildRealtimeSessionInstructions(resolvePersona(personaId));
    const calls = [
      buildRealtimeOpeningInstructions(personaId),
      buildRealtimeVisitOpeningInstructions(personaId),
      buildRealtimeIdleInstructions(personaId),
      buildRealtimeResponseInstructions({
        personaId, priority: 'notable', dartIndex: 1, turnScore: 60,
        checkedOut: false, busted: false, nextPlayerAlreadyThrowing: false,
      }),
    ];
    for (const call of calls) {
      expect(call.startsWith(contract + '\n\n# THIS CALL\n')).toBe(true);
      expect(call).toContain('An interrupted call is dead');
      expect(call).toContain('Invent no aim, intent, miss, record, or history');
    }
  });

  it('opens from supplied facts with room for persona performance', () => {
    const prompt = buildRealtimeOpeningInstructions('chad');

    expect(prompt).toContain('# Pre-match Opening');
    expect(prompt).toContain('introduce yourself by your persona name');
    expect(prompt).toContain('introduce this game');
    expect(prompt).toContain('starting mood leak through');
    expect(prompt).toContain('Never repeat it on reconnect');
    expect(prompt).toContain('authoritative match snapshot');
    expect(prompt).toContain('playful, specific observation');
    expect(prompt).toContain('5–14 words');
    expect(prompt).toContain(realtimePersonaResponseInstruction('chad'));
  });
  it('builds a labeled session prompt with one clear speaking contract', () => {
    const prompt = buildRealtimeSessionInstructions(resolvePersona('chad'));

    expect(prompt).toContain('# Role and Objective');
    expect(prompt).toContain('# Live Match Context');
    expect(prompt).toContain('# Speaking Behavior');
    expect(prompt).toContain('Context events update memory silently');
    expect(prompt).toContain('Do not repeat the same observation or joke');
    expect(prompt).toContain('at most 15 words');
    expect(prompt).not.toContain('visit total');
    expect(prompt).not.toContain('editorial unit');
  });

  it('uses Chad throughout Realtime calls for a retired Nord preference', () => {
    expect(buildRealtimeOpeningInstructions('nord')).toBe(buildRealtimeOpeningInstructions('chad'));
    expect(buildRealtimeVisitOpeningInstructions('nord')).toBe(buildRealtimeVisitOpeningInstructions('chad'));
    expect(buildRealtimeIdleInstructions('nord')).toBe(buildRealtimeIdleInstructions('chad'));
    const event = {
      priority: 'ordinary' as const, dartIndex: 1, turnScore: 20,
      checkedOut: false, busted: false, nextPlayerAlreadyThrowing: false,
    };
    expect(buildRealtimeResponseInstructions({ ...event, personaId: 'nord' })).toBe(
      buildRealtimeResponseInstructions({ ...event, personaId: 'chad' })
    );
  });

  it('keeps per-call guidance compact while reinforcing Chad on every call', () => {
    const prompt = buildRealtimeResponseInstructions({
      personaId: 'chad',
      priority: 'notable',
      dartIndex: 3,
      turnScore: 140,
      checkedOut: false,
      busted: false,
      visitDarts: [
        { segment: 'T20', scored: 60 },
        { segment: 'T20', scored: 60 },
        { segment: 'S20', scored: 20 },
      ],
      nextPlayerAlreadyThrowing: false,
    });

    const brief = prompt.split('# THIS CALL\n')[1];
    expect(brief.split('\n').length).toBeLessThanOrEqual(4);
    expect(brief.split('\n')[0]).toBe(realtimePersonaResponseInstruction('chad'));
    expect(prompt).not.toMatch(/CALL · (ordinary|notable|marquee|terminal)\b/);
    expect(prompt).toContain('completed visit');
    expect(prompt).toContain('DELIVERY · 3–8 words');
    expect(prompt).not.toContain('140');
    expect(prompt).not.toContain('T20');
    expect(prompt).not.toContain('consequence');
  });

  it('reserves the longest calls for marquee and terminal moments', () => {
    const visitEnd = { dartIndex: 3, checkedOut: false, busted: false, nikitaSpecial: false };
    expect(realtimeLengthInstruction({ ...visitEnd, priority: 'ordinary' })).toContain('3–10 words');
    expect(realtimeLengthInstruction({ ...visitEnd, priority: 'notable' })).toContain('3–8 words');
    expect(realtimeLengthInstruction({ ...visitEnd, priority: 'marquee' })).toContain('4–12 words');
    expect(realtimeLengthInstruction({ ...visitEnd, priority: 'terminal' })).toContain('4–12 words');
  });

  it('lets ordinary calls decline without weakening marquee obligations', () => {
    const ordinary = buildRealtimeResponseInstructions({
      priority: 'ordinary', dartIndex: 3, turnScore: 45,
      checkedOut: false, busted: false, nextPlayerAlreadyThrowing: false,
    });
    const marquee = buildRealtimeResponseInstructions({
      priority: 'marquee', dartIndex: 3, turnScore: 180,
      checkedOut: false, busted: false, nextPlayerAlreadyThrowing: false,
    });

    expect(ordinary).toContain('may skip');
    expect(marquee).not.toContain('may skip');
  });

  it('biases individual darts toward live micro-reactions', () => {
    expect(realtimeLengthInstruction({
      priority: 'notable',
      dartIndex: 1,
      checkedOut: false,
      busted: false,
      nikitaSpecial: false,
    })).toContain('0–2 words');
    expect(realtimeTextureInstruction({
      eventId: 'small-dart',
      priority: 'notable',
      dartIndex: 1,
      checkedOut: false,
      busted: false,
      nikitaSpecial: false,
      nextPlayerAvailable: false,
    }).length).toBeGreaterThan(0);
  });

  it('chooses delivery from the moment rather than arbitrary event IDs', () => {
    const brief = {
      priority: 'ordinary' as const, dartIndex: 1, checkedOut: false,
      busted: false, nextPlayerAlreadyThrowing: false, turnScore: 20,
    };
    expect(buildRealtimeResponseInstructions({ ...brief, eventId: 'a' }))
      .toBe(buildRealtimeResponseInstructions({ ...brief, eventId: 'b' }));
    expect(realtimeTextureInstruction(brief)).toContain('actual nonverbal audio');
  });

  it('leaves room for an urgent mid-visit reaction', () => {
    expect(realtimeLengthInstruction({
      priority: 'marquee', dartIndex: 1, checkedOut: false, busted: false,
    })).toBe('4–12 words');
  });

  it('keeps jokes anchored instead of allowing generic broadcast filler', () => {
    const session = buildRealtimeSessionInstructions(resolvePersona('chad'));
    const response = buildRealtimeResponseInstructions({
      personaId: 'chad', priority: 'notable', dartIndex: 2, turnScore: 120,
      checkedOut: false, busted: false, nextPlayerAlreadyThrowing: false,
    });

    expect(session).toContain('Anchor every claim to the concrete dart');
    expect(response).toContain('Anchor every claim to the concrete dart');
    expect(response).toContain(realtimePersonaResponseInstruction('chad'));
  });

  it('anchors Scolia visit openings to physical takeout completion', () => {
    const instructions = buildRealtimeVisitOpeningInstructions('chad');

    expect(instructions).toContain('takeout finished');
    expect(instructions).toContain('incoming player AND their remaining score');
    expect(instructions).toContain('no dart has landed');
    expect(instructions).toContain('2–8 words');
  });

  it('tells Chad to roast a bust directly', () => {
    const prompt = buildRealtimeResponseInstructions({
      personaId: 'chad',
      priority: 'marquee',
      dartIndex: 2,
      turnScore: 80,
      checkedOut: false,
      busted: true,
      nextPlayerAlreadyThrowing: false,
    });

    expect(prompt).toContain('CALL · bust · immediate roast');
  });

  it('lets one leg-winning call bridge into the supplied next leg', () => {
    const prompt = buildRealtimeResponseInstructions({
      personaId: 'chad',
      priority: 'marquee',
      dartIndex: 2,
      turnScore: 40,
      checkedOut: true,
      busted: false,
      nextPlayerAlreadyThrowing: false,
      legResolved: true,
      nextLegAvailable: true,
    });

    expect(prompt).toContain('RESULT · leg first');
    expect(prompt).toContain('next-leg starter may follow');
  });
});


describe('rivalry drama delivery', () => {
  const direction: BroadcastDirection = {
    schemaVersion: 1, sequence: 9, activeStoryArc: null, backgroundStoryArcs: [], transition: 'none',
    callback: null, shouldPromote: false, lifecycleEvents: [], rivalry: {
      rivalry: { key: 'streak', kind: 'streak', subjectId: 'a', counterpartId: 'b', scope: 'direct',
        fieldSize: 2, meetings: 5, subjectWins: 1, counterpartWins: 4, streak: 3 },
      eventId: 'live-finish', sequence: 9, stage: 'anticipate', development: 'match_dart', winnerId: null,
      callbackExcerpt: null, matchDart: { score: 32, target: 'D16' }, actorId: 'a',
    },
  };
  it.each(['chad', 'bob'] as const)('gives %s a short anticipatory hush without an incompatible mid-dart reaction instruction', (personaId) => {
    const prompt = buildRealtimeResponseInstructions({ personaId, priority: 'notable', dartIndex: 1,
      turnScore: 20, checkedOut: false, busted: false, nextPlayerAlreadyThrowing: false, direction });
    const brief = prompt.split('# THIS CALL')[1];
    expect(brief).toContain('DELIVERY · 2–6 words');
    expect(brief).toContain('sudden hush');
    expect(brief).toContain('no celebration yet');
    expect(brief).not.toContain('no sentence needed');
    expect(brief).not.toContain('result first');
  });
  it('directs an emotional reversal and then a winner-first payoff', () => {
    const input = { personaId: 'chad' as const, priority: 'terminal' as const, dartIndex: 3,
      turnScore: 32, checkedOut: true, busted: false, nextPlayerAlreadyThrowing: false };
    const payoff = buildRealtimeResponseInstructions({ ...input,
      direction: { ...direction, rivalry: { ...direction.rivalry!, stage: 'resolve', development: 'subject_won' } } });
    expect(payoff).toContain('own any misplaced earlier swagger');
    const twist = buildRealtimeResponseInstructions({ ...input, checkedOut: false, priority: 'notable',
      direction: { ...direction, rivalry: { ...direction.rivalry!, stage: 'twist', development: 'rival_response' } } });
    expect(twist).toContain('allegiance and confidence sideways');
  });
});


it('preserves unresolved fair-ending and forecast-expiry rules in per-call instructions', () => {
  const text = buildRealtimeResponseInstructions({ priority: 'marquee', dartIndex: 1, turnScore: 40,
    checkedOut: true, busted: false, nextPlayerAlreadyThrowing: false, fairEndingPending: true });
  expect(text).toContain('RESULT · unresolved fair ending');
  expect(text).toContain('No winner announcement');
  expect(text).toContain('Even a displayed 100% chance is not a result');
  expect(text).toContain('expires on the next dart, correction, or turn change');
});

describe('Cache-stable response transport', () => {
  it('keeps opening and idle instructions identical while appending their own direction', () => {
    const events = [buildRealtimeOpeningInstructions('chad'), buildRealtimeIdleInstructions('chad')]
      .map(instructions => realtimeResponseMessages({type: 'response.create', event_id: 'call',
        response: {instructions, metadata: {story_token: 'story'}, output_modalities: ['audio']}}));
    expect(events[0][1]).toEqual(events[1][1]);
    expect(JSON.stringify(events[0][0])).not.toEqual(JSON.stringify(events[1][0]));
    expect(JSON.stringify(events[1][0])).toContain('PAUSE');
    expect(JSON.stringify(events[1][1])).not.toContain('PAUSE');
  });
  it('leaves cancellation and non-response messages untouched', () => {
    const event = {type: 'response.cancel', event_id: 'cancel'};
    expect(realtimeResponseMessages(event, 'fresh scores')).toEqual([event]);
  });
});
