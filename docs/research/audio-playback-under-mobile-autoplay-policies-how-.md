# Audio playback under mobile autoplay policies: how to unlock audio on the first user gesture on iOS Safari 16+ and Android Chrome and then auto-play subsequent cards' previews (reusing one HTMLAudioElement vs Web Audio), preloading the next preview for <300ms start, handling standalone PWA mode quirks, and behaviour when the network drops.

Date: 2026-11-21 · Confidence: medium

## Recommendation

Build the sound affordance as: (1) a one-time unlock on the first user gesture — catch the first `play()` `NotAllowedError`, attach tap handlers that retry, leveraging sticky activation so every later card auto-plays for the session; (2) two reused `<audio preload="auto">` elements in an A/B double-buffer alternating play/preload of card previews — not a Web Audio pipeline (memory, decode-before-play, iOS context quirks, no streaming); (3) preload the next preview the moment the current card renders and gate the DoD on measured `play()`→`playing` p90 < 300 ms for preloaded cards; (4) treat audio failure as non-blocking for card lifecycle: pause/show buffering on `waiting`/`stalled`, retry code-2 `MediaError`s with backoff + `online` event while keeping the unlocked elements alive, and advance cards gracefully when offline. Spikes needed: silent-switch/standalone audio behavior on iOS PWA (consider Safari 16.4+ AudioSession API) and preload verification on iOS Safari.

## Findings

**1. Unlocking on first gesture — both platforms use "sticky activation", so one tap is genuinely enough.**
- iOS Safari (10 through 16+): playback via `play()` must "directly result from a handler" for `touchend`/`click`/`keydown` (WebKit iOS 10 policy); today this is framed as sticky user activation, which once set "lasts for the duration of the session" (MDN). So after the first tap anywhere, subsequent programmatic `play()` calls on card swipes succeed for the rest of the page session. `keydown`, `pointerup`/`touchend` count; `mousemove`/`wheel` do not.
- Android Chrome: `play()` outside a gesture rejects with `NotAllowedError` until user interaction with the domain; MEI only matters on desktop; muted autoplay is always allowed but previews should be audible anyway.
- Pattern to implement (matches howler.js' proven `onplayerror`/`onunlock` model): attempt `element.play()` on first card render; on rejection, attach tap handlers that call `play()` and immediately play the first preview; every subsequent `play()` then succeeds. Always check the play() promise — never assume success (Chrome docs + MDN).
- Web Audio caveat: an `AudioContext` created outside a gesture starts `suspended` and `resume()` must be called inside the gesture handler's call stack. Safari 16.4 fixed "only requiring a transient user activation for Web Audio rendering", but the resume-on-gesture pattern is still the documented safe path (Chrome + MDN).

**2. One HTMLAudioElement vs Web Audio: use a two-<audio> double-buffer, not a full Web Audio pipeline.**
- WebKit explicitly recommends reusing a single element and swapping sources ("autoplay restrictions are per-element: swap sources on a single element rather than creating multiple elements"). Creating fresh elements per card risks re-unlock issues on iOS (howler.js keeps a pre-unlocked node pool precisely because "every HTML5 Audio element must be unlocked individually" on older iOS).
- Web Audio gives ~1–10 ms start via `AudioBufferSourceNode.start()`, but requires the whole file decoded before playback (can't stream), costs ~10–11 MB per 30 s stereo 44.1 kHz clip as Float32 in an AudioBuffer, has iOS quirks (auto-suspend after idle, sample-rate mismatch 44.1 vs 48 kHz with Bluetooth routing, decode competing on the main thread) — all unnecessary for one clip at a time. howler supports both and keeps Web Audio nodes idle-suspended after 30 s to save battery.
- Recommended: two `<audio preload="auto">` elements alternating as slots A/B. Slot A plays card N; slot B preloads card N+1 (`src` set + `load()`; wait for `canplaythrough`). Swap roles on swipe. With the next clip already buffered, `play()`→`playing` is typically well under 300 ms; acceptance test should measure p90 from `play()` to the `playing` event with the next card preloaded, with the 300 ms budget as the pass line.

**3. Preloading strategy:** start loading card N+1's preview the moment card N renders/likes (HTTP cache or fetched blob; service-worker cache works in PWAs). Keep the unlock state by never recreating elements on errors — reset `src` and call `load()` on the existing element. iOS stores separately from Safari browser, so pre-caching must happen in the app's own session/SW.

**4. Standalone PWA quirks.**
- Chrome: "the user has added the site to their home screen" itself grants autoplay with sound on mobile (Chrome autoplay policy), so installed Android PWAs are effectively unrestricted — the first-tap unlock mainly matters pre-install and for iOS.
- iOS standalone: sticky activation resets on every cold launch, so replay the unlock routine on first gesture per launch — no special audio exemptions for home-screen web apps exist in WebKit's documented policies.
- Silent switch: Safari treats web media like ambient audio; the AudioSession Web API subset shipped in Safari 16.4 to control this — worth a spike if previews must override the mute switch; otherwise accept mute-switch behavior.
- Media Session API (iOS 15+, supported since iOS 15 per firt.dev) optional for lock-screen metadata; previews are short so low priority.

**5. Network drops.**
- Fully preloaded/buffered preview keeps playing through a network drop; only fetching card N+2 fails. Handle `error` event → `HTMLMediaElement.error.code`: code 2 (`MEDIA_ERR_NETWORK`) is retryable with backoff; code 4 (`MEDIA_ERR_SRC_NOT_SUPPORTED`) needs a different format, not retry. Listen to `stalled`/`waiting` to show buffering UI; a `waiting`→`playing` transition means auto-recovery.
- Recovery: exponential-backoff retry of the failed `src`, plus retry on the `online` event (and on `visibilitychange` returning visible). Use `navigator.onLine` only as a hint. Never hard-fail the card: on retry exhaustion, advance the card with a spinner/silent preview so the swipe flow survives. This defines the card-lifecycle hook: "audio failed" must not block navigation.

Residual unknowns (flag for implementation spikes): exact iOS silent-switch behavior for `<audio>` in standalone mode across iOS 16→18 (community reports vary; WebKit docs don't pin it), and whether iOS honors `preload="auto"` reliably — hence the belt-and-braces fetch-into-cache preload.

## Sources

- [Chrome — Autoplay Policy Changes (developer.chrome.com/blog/autoplay)](https://developer.chrome.com/blog/autoplay)
- [MDN — Autoplaying media guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
- [WebKit — Auto-Play Policy Changes for macOS](https://webkit.org/blog/7734/auto-play-policy-changes-for-macos/)
- [WebKit — New <video> Policies for iOS 10](https://webkit.org/blog/6784/new-video-policies-for-ios10/)
- [MDN — Sticky activation glossary](https://developer.mozilla.org/en-US/docs/Glossary/Sticky_activation)
- [MDN — Web Audio API Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)
- [WebKit — WebKit Features in Safari 16.4 (AudioSession Web API, Web Audio activation fix, PWA push)](https://webkit.org/blog/13959/webkit-features-in-safari-16-4/)
- [howler.js README — mobile audio unlock and play-error patterns](https://raw.githubusercontent.com/goldfire/howler.js/master/README.md)
- [MDN — HTMLMediaElement error event / MediaError codes](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/error_event)
- [firt.dev — iOS PWA compatibility notes](https://firt.dev/notes/pwa-ios/)
