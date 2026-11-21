import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { MusicApp } from '../../links/links';
import { useStore } from '../../store/store';
import type { Settings } from '../../types';
import { Button } from '../Button';
import { CloseIcon } from '../icons';
import { withTransition } from '../transition';

const MUSIC_APPS: readonly { id: MusicApp; label: string }[] = [
  { id: 'spotify', label: 'Spotify' },
  { id: 'apple', label: 'Apple Music' },
  { id: 'ytmusic', label: 'YouTube Music' },
];

const THEMES: readonly { id: Settings['theme']; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function SettingsSheet() {
  const isOpen = useStore((state) => state.settingsOpen);
  const setSettingsOpen = useStore((state) => state.setSettingsOpen);
  const settings = useStore((state) => state.settings);
  const setSettings = useStore((state) => state.setSettings);
  const resetAll = useStore((state) => state.resetAll);
  const setScreen = useStore((state) => state.setScreen);

  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);

  // Focus moves into the sheet on open and back to the control that opened it.
  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheetRef.current?.focus();
    return () => opener?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, setSettingsOpen]);

  const close = () => {
    setSettingsOpen(false);
    setIsConfirmingReset(false);
  };

  // Seeds are kept: the sheet is the mid-session way back to Setup.
  const editSeeds = () => {
    setSettingsOpen(false);
    withTransition(() => setScreen('setup'));
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const items = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) => !element.hasAttribute('disabled'),
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || active === sheet)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="sheet-backdrop" role="presentation" onClick={close}>
      <section
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <header className="sheet__header">
          <h2 id="settings-title" className="sheet__title">
            Settings
          </h2>
          <button type="button" className="icon-button" aria-label="Close settings" onClick={close}>
            <CloseIcon />
          </button>
        </header>

        <div className="screen">
          <section className="setup__section" aria-labelledby="settings-app-label">
            <h3 id="settings-app-label" className="setup__label">
              Music app
            </h3>
            <div className="segmented" role="group" aria-labelledby="settings-app-label">
              {MUSIC_APPS.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  className="segmented__button"
                  aria-pressed={settings.musicApp === app.id}
                  onClick={() => setSettings({ musicApp: app.id })}
                >
                  {app.label}
                </button>
              ))}
            </div>
          </section>

          <section className="setup__section" aria-labelledby="settings-sound-label">
            <h3 id="settings-sound-label" className="setup__label">
              Sound
            </h3>
            <div className="switch-row">
              <span className="screen__body">Samples play on each card.</span>
              <button
                type="button"
                role="switch"
                className="switch"
                aria-label={settings.sound ? 'Sound is on' : 'Sound is off'}
                aria-checked={settings.sound}
                onClick={() => setSettings({ sound: !settings.sound })}
              >
                <span className="switch__track" aria-hidden="true">
                  <span className="switch__thumb" />
                </span>
              </button>
            </div>
          </section>

          <section className="setup__section" aria-labelledby="settings-wildcards-label">
            <h3 id="settings-wildcards-label" className="setup__label">
              Something different
            </h3>
            <div className="switch-row">
              <span className="screen__body">
                Now and then, a card outside your usual genres.
              </span>
              <button
                type="button"
                role="switch"
                className="switch"
                aria-label="Something different"
                aria-checked={settings.wildcards}
                onClick={() => setSettings({ wildcards: !settings.wildcards })}
              >
                <span className="switch__track" aria-hidden="true">
                  <span className="switch__thumb" />
                </span>
              </button>
            </div>
          </section>

          <section className="setup__section" aria-labelledby="settings-seeds-label">
            <h3 id="settings-seeds-label" className="setup__label">
              Your seeds
            </h3>
            <Button variant="secondary" onClick={editSeeds}>
              Edit seeds
            </Button>
          </section>

          <section className="setup__section" aria-labelledby="settings-theme-label">
            <h3 id="settings-theme-label" className="setup__label">
              Theme
            </h3>
            <div className="segmented" role="group" aria-labelledby="settings-theme-label">
              {THEMES.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className="segmented__button"
                  aria-pressed={settings.theme === theme.id}
                  onClick={() => setSettings({ theme: theme.id })}
                >
                  {theme.label}
                </button>
              ))}
            </div>
          </section>

          <section className="setup__section" aria-labelledby="settings-data-label">
            <h3 id="settings-data-label" className="setup__label">
              Your data
            </h3>
            {isConfirmingReset ? (
              <div className="setup__section">
                <p className="sheet__body">
                  This deletes your seeds, likes and taste on this device.
                </p>
                <div className="sheet__confirm-actions">
                  <Button variant="secondary" autoFocus onClick={() => setIsConfirmingReset(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      resetAll();
                      setIsConfirmingReset(false);
                    }}
                  >
                    Delete everything
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="secondary-danger" onClick={() => setIsConfirmingReset(true)}>
                Reset all my data
              </Button>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
