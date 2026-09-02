import { describe, expect, it } from 'vitest';

import {
  realtimePersonaResponseInstruction,
  resolvePersona,
} from './personas';

describe('commentary persona language contracts', () => {
  it('forces Chad back to the original English surf-bro voice after editorial instructions', () => {
    const instruction = realtimePersonaResponseInstruction('chad');

    expect(resolvePersona('chad').systemPrompt).toContain('# Role and Objective');
    expect(resolvePersona('chad').systemPrompt).toContain('full Gen Z register');
    expect(resolvePersona('chad').systemPrompt).toContain('MAX OUT the relaxed surfer energy');
    expect(resolvePersona('chad').systemPrompt).toContain('# Surfer Worldview');
    expect(resolvePersona('chad').systemPrompt).toContain('# Anti-Broadcast Language');
    expect(resolvePersona('chad').systemPrompt).toContain('vibes are medically concerning');
    expect(resolvePersona('chad').systemPrompt).toContain('one-word reaction or spicy micro-reaction');
    expect(resolvePersona('chad').systemPrompt).toContain('Bad darts are premium content');
    expect(resolvePersona('chad').systemPrompt).toContain('Generational fumble');
    expect(resolvePersona('chad').systemPrompt).toContain('Slang is instinct, not a quota');
    expect(resolvePersona('chad').systemPrompt).toContain('# Variety');
    expect(resolvePersona('chad').systemPrompt).toContain('speaking pace natural and brisk');
    expect(resolvePersona('chad').style.maxWords).toBe(15);
    expect(instruction).toContain('maximum relaxed Gen Z surf-bro energy');
    expect(instruction).toContain('zero sterile broadcast filler');
    expect(instruction).not.toMatch(/one or two|at most one|0-1/);
    expect(instruction).not.toContain('STAVANGER');
  });

  it('keeps Bob in English', () => {
    expect(realtimePersonaResponseInstruction('bob')).toContain('natural English broadcast commentary');
  });
});
