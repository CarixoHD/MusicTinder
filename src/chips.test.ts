import { describe, expect, it } from 'vitest';
import { CHIPS, normalizeGenre } from './chips';

describe('normalizeGenre', () => {
  it('maps slash-joined catalog genres to their curated chip', () => {
    expect(normalizeGenre('Hip-Hop/Rap')).toEqual(['hip-hop']);
    expect(normalizeGenre('R&B/Soul')).toEqual(['r&b-soul']);
  });

  it('splits multi-genre strings across the curated chips', () => {
    expect(normalizeGenre('Rock/Pop')).toEqual(['rock', 'pop']);
  });

  it('returns other for unknown genres', () => {
    expect(normalizeGenre('Zydeco')).toEqual(['other']);
    expect(normalizeGenre('')).toEqual(['other']);
  });

  it('deduplicates chips that share a mapping', () => {
    expect(normalizeGenre('Rap/Hip Hop')).toEqual(['hip-hop']);
  });
});

describe('CHIPS', () => {
  it('is a unique, curated set with the other catch-all', () => {
    const ids = CHIPS.map((chip) => chip.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('other');
  });
});
