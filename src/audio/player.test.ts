import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

// jsdom has no media stack: playback state lives in these stubs, which is all
// the player is allowed to rely on.
let playing: WeakSet<HTMLMediaElement>;

const playingElement = (): HTMLAudioElement => {
  const found = elements().find((element) => !element.paused);
  if (!found) throw new Error('no audio element is playing');
  return found;
};

beforeEach(() => {
  playing = new WeakSet();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    playing.add(this);
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    playing.delete(this);
    this.dispatchEvent(new Event('pause'));
  });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function (this: HTMLMediaElement) {
    return !playing.has(this);
  });
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
    const [a, b] = elements();
    expect(a.paused).toBe(false);

    player.preload(card('two', 'https://audio.example.test/two.m4a'));

    expect(b.src).toBe('https://audio.example.test/two.m4a');
    expect(a.src).toBe('https://audio.example.test/one.m4a');
    expect(a.paused).toBe(false);

    // Playing the preloaded card swaps the active buffer instead of reloading.
    player.play(card('two', 'https://audio.example.test/two.m4a'));
    expect(b.paused).toBe(false);
    expect(a.paused).toBe(true);
  });

  it('reports no sample for a card without a preview without throwing', () => {
    const player = new PreviewPlayer();
    expect(() => player.play(card('none'))).not.toThrow();
    expect(player.play(card('none'))).toBe('nosample');
    expect(player.getSnapshot()).toMatchObject({ status: 'nosample', key: 'none' });
  });

  it('reports no sample when the browser cannot play the source (media error 4)', () => {
    const player = new PreviewPlayer();
    expect(player.play(card('bad', 'https://audio.example.test/bad.m4a'))).toBe('playing');

    const element = playingElement();
    Object.defineProperty(element, 'error', { configurable: true, value: { code: 4 } });
    element.dispatchEvent(new Event('error'));

    expect(player.getSnapshot()).toMatchObject({ status: 'nosample', key: 'bad' });
  });

  it('retries a network error a bounded number of times, then reports no sample', () => {
    vi.useFakeTimers();
    const player = new PreviewPlayer();
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    player.play(card('flaky', 'https://audio.example.test/flaky.m4a'));

    const element = playingElement();
    let code = 2;
    Object.defineProperty(element, 'error', { configurable: true, get: () => ({ code }) });
    const failNetwork = () => element.dispatchEvent(new Event('error'));

    const plays = () => play.mock.calls.length;

    failNetwork();
    expect(player.getSnapshot().status).toBe('paused');
    vi.advanceTimersByTime(1_000);
    expect(plays()).toBe(2);

    failNetwork();
    vi.advanceTimersByTime(1_000);
    expect(plays()).toBe(3);

    // Three failures is one attempt plus the two permitted retries.
    failNetwork();
    vi.advanceTimersByTime(1_000);
    expect(plays()).toBe(3);
    expect(player.getSnapshot().status).toBe('nosample');

    code = 2;
  });

  it('stops and resumes the same card instead of reloading it', () => {
    const player = new PreviewPlayer();
    player.play(card('one', 'https://audio.example.test/one.m4a'));
    const element = playingElement();

    player.stop();
    expect(element.paused).toBe(true);
    expect(player.getSnapshot().status).toBe('paused');

    player.play(card('one', 'https://audio.example.test/one.m4a'));
    expect(element.paused).toBe(false);
    expect(element.src).toBe('https://audio.example.test/one.m4a');
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
    expect(elements().every((element) => element.paused)).toBe(true);
    expect(player.getSnapshot().status).toBe('idle');
  });
});
