import { describe, expect, it } from 'vitest';

import { resolvePersona } from './personas';
import {
  buildRealtimeResponseInstructions,
  buildRealtimeSessionInstructions,
  realtimeLengthInstruction,
} from './realtimePrompt';

describe('Realtime commentary prompts', () => {
  it('builds a labeled session prompt with one clear speaking contract', () => {
    const prompt = buildRealtimeSessionInstructions(resolvePersona('chad'));

    expect(prompt).toContain('# Role and Objective');
    expect(prompt).toContain('# Live Match Context');
    expect(prompt).toContain('# Speaking Behavior');
    expect(prompt).toContain('Context events update memory silently');
    expect(prompt).toContain('at most 15 words');
    expect(prompt).not.toContain('visit total');
    expect(prompt).not.toContain('editorial unit');
  });

  it('keeps per-call guidance compact and leaves sentence construction to Chad', () => {
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

    expect(prompt).toContain('# Current Call');
    expect(prompt).toContain('Moment: notable');
    expect(prompt).toContain('completed visit as one beat');
    expect(prompt).toContain('Length: 3–8 words');
    expect(prompt).toContain('maximum relaxed Gen Z surf-bro energy');
    expect(prompt).not.toContain('140');
    expect(prompt).not.toContain('T20');
    expect(prompt).not.toContain('consequence');
  });

  it('reserves the longest calls for marquee and terminal moments', () => {
    const visitEnd = { dartIndex: 3, checkedOut: false, busted: false, nikitaSpecial: false };
    expect(realtimeLengthInstruction({ ...visitEnd, priority: 'ordinary' })).toContain('1–7 words');
    expect(realtimeLengthInstruction({ ...visitEnd, priority: 'notable' })).toContain('3–8 words');
    expect(realtimeLengthInstruction({ ...visitEnd, priority: 'marquee' })).toContain('4–12 words');
    expect(realtimeLengthInstruction({ ...visitEnd, priority: 'terminal' })).toContain('4–12 words');
  });

  it('biases individual darts toward one-word reactions', () => {
    expect(realtimeLengthInstruction({
      priority: 'notable',
      dartIndex: 1,
      checkedOut: false,
      busted: false,
      nikitaSpecial: false,
    })).toContain('1–5 words');
    expect(realtimeLengthInstruction({
      priority: 'notable',
      dartIndex: 1,
      checkedOut: false,
      busted: false,
      nikitaSpecial: false,
    })).toContain('one-word or spicy micro-reaction');
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

    expect(prompt).toContain('Moment: bust');
    expect(prompt).toContain('roast the failed visit without cushioning it');
  });
});
