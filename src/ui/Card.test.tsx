import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Card as CardModel } from '../types';
import { Card } from './Card';

let container: HTMLDivElement;
let root: Root;

const card = (overrides: Partial<CardModel> & Pick<CardModel, 'kind'>): CardModel => ({
  key: 'card',
  source: 'itunes',
  title: 'Glass Harbour',
  creator: 'Glass Harbour',
  creatorKey: 'glass harbour',
  chips: [],
  ...overrides,
});

const mount = (model: CardModel): void => {
  act(() => root.render(<Card card={model} />));
};

const texts = (selector: string): string[] =>
  [...container.querySelectorAll(selector)].map((element) => element.textContent ?? '');

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Card genre placement', () => {
  it('names an artist genre once, in the tag row, when it is the only genre', () => {
    mount(card({ kind: 'artist', chips: ['alternative'] }));

    expect(texts('.card__creator')).toEqual(['Artist']);
    expect(texts('.tag')).toEqual(['Alternative']);
  });

  it('uses the second line for the first genre and the tag row for the second', () => {
    mount(card({ kind: 'artist', chips: ['alternative', 'indie'] }));

    expect(texts('.card__creator')).toEqual(['Artist · Alternative']);
    expect(texts('.tag')).toEqual(['Indie']);
  });

  it('shows an album release type as a tag without repeating it in the title', () => {
    mount(
      card({
        kind: 'album',
        title: 'Bitch',
        creator: 'The BossHoss',
        releaseType: 'Single',
        chips: ['country'],
      }),
    );

    expect(texts('.card__title')).toEqual(['Bitch']);
    expect(texts('.tag')).toEqual(['Single', 'Country']);
    expect(texts('.card__creator')).toEqual(['The BossHoss']);
  });
});
