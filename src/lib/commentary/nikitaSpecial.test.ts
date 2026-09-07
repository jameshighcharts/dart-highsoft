import { describe, expect, it } from 'vitest';
import { nikitaSpecialMoment } from './nikitaSpecial';

describe('Nikita Special identity', () => {
  it.each(['Nikita', ' nikita ', 'Nikita Hansen'])('gives %s the namesake celebration', (name) => {
    expect(nikitaSpecialMoment(name)).toContain('Nikita himself');
  });
  it.each(['Ken', 'Anikita', 'NikitaFan'])('keeps the shared celebration without misidentifying %s', (name) => {
    expect(nikitaSpecialMoment(name)).toContain('office cult classic');
    expect(nikitaSpecialMoment(name)).not.toContain('Nikita himself');
  });
});
