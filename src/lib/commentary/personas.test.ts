import { describe, expect, it } from 'vitest';

import {
  COMMENTARY_PERSONA_LIST,
  realtimePersonaResponseInstruction,
  commentaryStartingMood,
  resolvePersona,
  nikitaSpecialMoment,
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

  it('falls back to Chad for a saved retired Nord preference', () => {
    expect(COMMENTARY_PERSONA_LIST.map((persona) => persona.id)).toEqual(['chad', 'bob']);
    expect(resolvePersona('nord')).toBe(resolvePersona('chad'));
    expect(realtimePersonaResponseInstruction('nord')).toBe(
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

describe('Nikita Special identity', () => {
  it.each(['Nikita', ' nikita ', 'Nikita Hansen'])('gives %s the namesake celebration', (name) => {
    expect(nikitaSpecialMoment(name)).toContain('Nikita himself');
  });
  it.each(['Ken', 'Anikita', 'NikitaFan'])('keeps the shared celebration without misidentifying %s', (name) => {
    expect(nikitaSpecialMoment(name)).toContain('office cult classic');
    expect(nikitaSpecialMoment(name)).not.toContain('Nikita himself');
  });
});
