import { useEffect } from 'react';
import { useStore } from '../../store/store';
import { CloseIcon } from '../icons';

export default function SettingsSheet() {
  const isOpen = useStore((state) => state.settingsOpen);
  const setSettingsOpen = useStore((state) => state.setSettingsOpen);
  const close = () => setSettingsOpen(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, setSettingsOpen]);

  if (!isOpen) return null;

  return (
    <div className="sheet-backdrop" role="presentation" onClick={close}>
      <section
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sheet__header">
          <h2 id="settings-title" className="sheet__title">
            Settings
          </h2>
          <button type="button" className="icon-button" aria-label="Close settings" onClick={close}>
            <CloseIcon />
          </button>
        </header>
        <p className="sheet__body">Music app, sound, theme and reset are on their way.</p>
      </section>
    </div>
  );
}
