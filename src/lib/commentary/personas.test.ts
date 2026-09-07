import { describe, expect, it } from 'vitest';

import {
  realtimePersonaResponseInstruction,
  commentaryStartingMood,
  resolvePersona,
} from './personas';

describe('commentary persona contracts', () => {
  it('resolves Chad as a complete selectable persona', () => {
    const persona = resolvePersona('chad');
    const instruction = realtimePersonaResponseInstruction('chad');

    expect(persona.id).toBe('chad');
    expect(persona.style.maxWords).toBe(15);
    expect(persona.systemPrompt.length).toBeGreaterThan(0);
    expect(instruction.length).toBeGreaterThan(20);
  });

  it('resolves Bob independently from Chad', () => {
    expect(resolvePersona('bob')).toMatchObject({ id: 'bob' });
    expect(realtimePersonaResponseInstruction('bob')).not.toBe(
      realtimePersonaResponseInstruction('chad')
    );
  });

  it('offers a Nordlending persona with its own response voice', () => {
    expect(resolvePersona('nord')).toMatchObject({
      id: 'nord',
      label: 'Oluf "Sjarken"',
      avatar: '⛵',
    });
    expect(resolvePersona('nord').systemPrompt).toContain('Snakk naturlig nordnorsk');
    expect(resolvePersona('nord').systemPrompt).toContain('Sjarken');
    expect(realtimePersonaResponseInstruction('nord')).not.toBe(
      realtimePersonaResponseInstruction('chad')
    );
  });
});


describe('commentator starting mood', () => {
  it('keeps the same premise for a match while varying across matches', () => {
    const initial = commentaryStartingMood('same-match');
    expect(commentaryStartingMood('same-match')).toBe(initial);
    const moods = new Set(Array.from({ length: 64 }, (_, index) => commentaryStartingMood(`match-${index}`)));
    expect(moods.size).toBe(6);
  });
});
