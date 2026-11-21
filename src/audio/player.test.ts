import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Card } from '../types';
import { PreviewPlayer } from './player';

const card = (key: string, previewUrl?: string): Card => ({
  key,
  kind: 'song',
  source: 'itunes',
  title: key,
  creator: 'Test Artist',
  creatorKey: 'test artist',
  image: 'https://cdn.example.test/art.jpg',
  previewUrl,
  chips: ['pop'],
});

const elements = (): HTMLAudioElement[] => [...document.querySelectorAll('audio')];

const bySrc = (url: string): HTMLAudioElement => {
  const found = elements().find((element) => element.getAttribute('src') === url);
  if (!found) throw new Error(`no audio element has src ${url}`);
  return found;
};

/** Observation only: these spies let the real element implementation run. */
const callsOn = (spy: MockInstance, element: HTMLAudioElement): number =>
  spy.mock.instances.filter((instance) => instance === element).length;

let play: MockInstance;
let pause: MockInstance;

beforeEach(() => {
  play = vi.spyOn(HTMLMediaElement.prototype, 'play');
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause');
  vi.spyOn(HTMLMediaElement.prototype, 'load');
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('PreviewPlayer', () => {
  it('reuses exactly two audio elements for every card it plays or preloads', () => {
    const player = new PreviewPlayer();
    expect(elements()).toHaveLength(2);

    player.play(card('one', 'https://audio.example.test/one.m4a'));
    player.preload(card('two', 'https://audio.example.test/two.m4a'));
    player.stop();
    player.play(card('three', 'https://audio.example.test/three.m4a'));
    player.play(card('four', 'https://audio.example.test/four.m4a'));

    expect(elements()).toHaveLength(2);
  });

  it('preloads into the idle buffer while the other keeps playing', () => {
    const player = new PreviewPlayer();
    player.play(card('one', 'https://audio.example.test/one.m4a'));
    const a = bySrc('https://audio.example.test/one.m4a');

    player.preload(card('two', 'https://audio.example.test/two.m4a'));
    const b = bySrc('https://audio.example.test/two.m4a');

    expect(a).not.toBe(b);
    expect(a.getAttribute('src')).toBe('https://audio.example.test/one.m4a');

    // Playing the preloaded card swaps the active buffer instead of reloading.
    player.play(card('two', 'https://audio.example.test/two.m4a'));
    expect(callsOn(play, b)).toBe(1);
    expect(callsOn(play, a)).toBe(1);
    expect(callsOn(pause, a)).toBe(1);
    expect(b.getAttribute('src')).toBe('https://audio.example.test/two.m4a');
  });

  it('reports no sample for a card without a preview without throwing', () => {
    const player = new PreviewPlayer();
    expect(() => player.play(card('none'))).not.toThrow();
    expect(player.play(card('none'))).toBe('nosample');
    expect(player.getSnapshot()).toMatchObject({ status: 'nosample', key: 'none' });
    expect(callsOn(play, elements()[0])).toBe(0);
  });

  it('reports no sample when the browser cannot play the source (media error 4)', () => {
    const player = new PreviewPlayer();
    expect(player.play(card('bad', 'https://audio.example.test/bad.m4a'))).toBe('playing');

    const element = bySrc('https://audio.example.test/bad.m4a');
    Object.defineProperty(element, 'error', { configurable: true, value: { code: 4 } });
    element.dispatchEvent(new Event('error'));

    expect(player.getSnapshot()).toMatchObject({ status: 'nosample', key: 'bad' });
  });

  it('retries a network error a bounded number of times, then reports no sample', () => {
    vi.useFakeTimers();
    const player = new PreviewPlayer();
    player.play(card('flaky', 'https://audio.example.test/flaky.m4a'));
    const element = bySrc('https://audio.example.test/flaky.m4a');

    const code = 2;
    Object.defineProperty(element, 'error', { configurable: true, get: () => ({ code }) });
    const failNetwork = () => element.dispatchEvent(new Event('error'));

    failNetwork();
    expect(player.getSnapshot().status).toBe('paused');
    vi.advanceTimersByTime(1_000);
    expect(callsOn(play, element)).toBe(2);

    failNetwork();
    vi.advanceTimersByTime(1_000);
    expect(callsOn(play, element)).toBe(3);

    // Three failures is one attempt plus the two permitted retries.
    failNetwork();
    vi.advanceTimersByTime(1_000);
    expect(callsOn(play, element)).toBe(3);
    expect(player.getSnapshot().status).toBe('nosample');
  });

  it('stops and resumes the same card instead of reloading it', () => {
    const player = new PreviewPlayer();
    player.play(card('one', 'https://audio.example.test/one.m4a'));
    const element = bySrc('https://audio.example.test/one.m4a');

    player.stop();
    expect(callsOn(pause, element)).toBe(1);
    expect(player.getSnapshot().status).toBe('paused');

    player.play(card('one', 'https://audio.example.test/one.m4a'));
    expect(callsOn(play, element)).toBe(2);
    expect(element.getAttribute('src')).toBe('https://audio.example.test/one.m4a');
    expect(player.getSnapshot().status).toBe('playing');
  });

  it('mutes and unmutes both buffers', () => {
    const player = new PreviewPlayer();
    player.setMuted(true);
    expect(elements().every((element) => element.muted)).toBe(true);

    player.setMuted(false);
    expect(elements().every((element) => !element.muted)).toBe(true);
  });

  it('unlocks both elements on the first gesture without leaving sound playing', async () => {
    const player = new PreviewPlayer();
    await player.unlockOnGesture();

    expect(elements()).toHaveLength(2);
    for (const element of elements()) {
      expect(callsOn(play, element)).toBe(1);
      expect(callsOn(pause, element)).toBe(1);
      expect(element.getAttribute('src')).toBeNull();
    }
    expect(player.getSnapshot().status).toBe('idle');
  });
});
