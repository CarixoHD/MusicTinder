import type { Card } from '../types';

export type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'nosample';

export interface PlayerSnapshot {
  status: PlaybackStatus;
  /** Key of the card the snapshot describes; null when nothing has played. */
  key: string | null;
  /** 0..1 of the current sample's duration. */
  progress: number;
}

// MediaError codes, named here because jsdom has no MediaError constructor.
const MEDIA_ERR_NETWORK = 2;
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 300;
// A gesture needs a source to play while both real buffers are still empty.
const SILENT_SRC = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

const other = (index: 0 | 1): 0 | 1 => (index === 0 ? 1 : 0);

/**
 * The preview engine (ARCHITECTURE §audio): exactly two reused <audio> elements
 * in an A/B double buffer. One gesture unlocks playback; after that each card
 * plays on the buffer its preview was preloaded into. A missing or unplayable
 * preview degrades to 'nosample' — never an exception, never a blocked swipe.
 */
export class PreviewPlayer {
  private readonly buffers: [HTMLAudioElement, HTMLAudioElement];
  private readonly keys: [string | null, string | null] = [null, null];
  private readonly retries: [number, number] = [0, 0];
  private readonly timers: [ReturnType<typeof setTimeout> | null, ReturnType<typeof setTimeout> | null] =
    [null, null];
  private readonly listeners = new Set<() => void>();
  private snapshot: PlayerSnapshot = { status: 'idle', key: null, progress: 0 };
  private activeIndex: 0 | 1 = 0;
  private unlocked = false;

  constructor() {
    this.buffers = [this.createBuffer(0), this.createBuffer(1)];
  }

  /** React's useSyncExternalStore seam; stable identities. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PlayerSnapshot => this.snapshot;

  /** First user gesture: prime both buffers so later cards may play unasked. */
  async unlockOnGesture(): Promise<void> {
    if (this.unlocked) return;
    this.unlocked = true;

    await Promise.all(
      this.buffers.map(async (element, index) => {
        const hadSource = element.getAttribute('src') !== null;
        if (!hadSource) element.src = SILENT_SRC;
        const wasMuted = element.muted;
        element.muted = true;
        try {
          await element.play();
        } catch {
          // Still locked here; the tap that called play() will try again.
        }
        // A card the tap started on this buffer is real playback — keep it.
        const isCurrent =
          this.snapshot.key !== null &&
          this.snapshot.status === 'playing' &&
          this.activeIndex === index;
        if (!isCurrent) {
          element.pause();
          element.currentTime = 0;
          if (!hadSource) {
            this.keys[index] = null;
            element.removeAttribute('src');
          }
        }
        element.muted = wasMuted;
      }),
    );
  }

  play(card: Card): 'playing' | 'nosample' {
    if (!card.previewUrl) {
      this.pauseAll();
      this.emit({ status: 'nosample', key: card.key, progress: 0 });
      return 'nosample';
    }

    const index = this.pickBuffer(card.previewUrl);
    const element = this.buffers[index];
    this.clearTimers();

    if (this.keys[index] !== card.previewUrl) {
      this.keys[index] = card.previewUrl;
      this.retries[index] = 0;
      element.src = card.previewUrl;
      element.load();
    }

    const previous = this.buffers[other(index)];
    if (!previous.paused) previous.pause();

    this.activeIndex = index;
    this.emit({ status: 'playing', key: card.key, progress: this.progressOf(element) });
    this.start(element, card.key);
    return 'playing';
  }

  /** Load the next card into the idle buffer so its sample starts within ~300 ms. */
  preload(next: Card): void {
    if (!next.previewUrl || this.keys.includes(next.previewUrl)) return;
    const idleIndex = other(this.activeIndex);
    const idle = this.buffers[idleIndex];
    this.clearTimer(idleIndex);
    this.keys[idleIndex] = next.previewUrl;
    this.retries[idleIndex] = 0;
    idle.src = next.previewUrl;
    idle.load();
  }

  /** Pause the current sample; play(card) resumes it where it stopped. */
  stop(): void {
    this.clearTimers();
    const active = this.buffers[this.activeIndex];
    if (!active.paused) active.pause();
    const { key } = this.snapshot;
    this.emit({
      status: key === null ? 'idle' : 'paused',
      key,
      progress: this.progressOf(active),
    });
  }

  setMuted(muted: boolean): void {
    for (const element of this.buffers) element.muted = muted;
  }

  private createBuffer(index: 0 | 1): HTMLAudioElement {
    const element = document.createElement('audio');
    element.preload = 'auto';
    element.muted = false;
    element.setAttribute('aria-hidden', 'true');
    element.dataset.previewBuffer = String(index);
    element.addEventListener('error', () => this.handleError(index));
    element.addEventListener('timeupdate', () => this.handleTimeUpdate(index));
    element.addEventListener('ended', () => {
      if (this.isActive(index)) this.emit({ ...this.snapshot, status: 'paused', progress: 1 });
    });
    element.addEventListener('pause', () => {
      if (this.isActive(index) && this.snapshot.status === 'playing') {
        this.emit({ ...this.snapshot, status: 'paused' });
      }
    });
    document.body.append(element);
    return element;
  }

  private isActive(index: number): boolean {
    return this.snapshot.key !== null && this.activeIndex === index;
  }

  /**
   * The buffer already holding this preview, else an empty active buffer on a
   * fresh player, else the idle one (the preloaded B slot).
   */
  private pickBuffer(previewUrl: string): 0 | 1 {
    if (this.keys[0] === previewUrl) return 0;
    if (this.keys[1] === previewUrl) return 1;
    const activeEmpty =
      this.keys[this.activeIndex] === null && this.buffers[this.activeIndex].getAttribute('src') === null;
    return activeEmpty ? this.activeIndex : other(this.activeIndex);
  }

  private start(element: HTMLAudioElement, key: string): void {
    const started: Promise<void> | undefined = element.play();
    if (!started || typeof started.catch !== 'function') return;
    started.catch((error: unknown) => {
      if (this.snapshot.key !== key) return;
      const name = error instanceof Error ? error.name : '';
      if (name === 'AbortError') return;
      if (name === 'NotAllowedError') {
        // Autoplay needs a tap; the card stays playable, it is not "no sample".
        this.emit({ ...this.snapshot, status: 'paused' });
        return;
      }
      this.emit({ status: 'nosample', key, progress: 0 });
    });
  }

  private handleError(index: 0 | 1): void {
    const previewUrl = this.keys[index];
    if (previewUrl === null || this.snapshot.key === null || this.activeIndex !== index) return;
    const element = this.buffers[index];

    if (element.error?.code === MEDIA_ERR_NETWORK && this.retries[index] < MAX_RETRIES) {
      this.retries[index] += 1;
      this.emit({ ...this.snapshot, status: 'paused' });
      this.clearTimer(index);
      this.timers[index] = setTimeout(() => {
        this.timers[index] = null;
        if (this.keys[index] !== previewUrl || this.activeIndex !== index) return;
        element.load();
        this.start(element, this.snapshot.key ?? '');
      }, RETRY_BASE_MS * this.retries[index]);
      return;
    }

    this.emit({ status: 'nosample', key: this.snapshot.key, progress: 0 });
  }

  private handleTimeUpdate(index: 0 | 1): void {
    if (!this.isActive(index)) return;
    const progress = this.progressOf(this.buffers[index]);
    if (Math.abs(progress - this.snapshot.progress) < 0.005) return;
    this.emit({ ...this.snapshot, progress });
  }

  private progressOf(element: HTMLAudioElement): number {
    const duration = element.duration;
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    return Math.max(0, Math.min(1, element.currentTime / duration));
  }

  private pauseAll(): void {
    this.clearTimers();
    for (const element of this.buffers) {
      if (!element.paused) element.pause();
    }
  }

  private clearTimer(index: 0 | 1): void {
    const timer = this.timers[index];
    if (timer !== null) clearTimeout(timer);
    this.timers[index] = null;
  }

  private clearTimers(): void {
    this.clearTimer(0);
    this.clearTimer(1);
  }

  private emit(next: PlayerSnapshot): void {
    const { status, key, progress } = this.snapshot;
    if (status === next.status && key === next.key && progress === next.progress) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

let shared: PreviewPlayer | null = null;

/** One A/B pair for the whole app, created on first use. */
export function previewPlayer(): PreviewPlayer {
  shared ??= new PreviewPlayer();
  return shared;
}
