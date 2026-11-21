import { LazyMotion, MotionConfig } from 'motion/react';
import { useEffect, type ComponentType } from 'react';
import { previewPlayer } from '../audio/player';
import { useStore, type Screen } from '../store/store';
import {
  CloseIcon,
  DiscoverIcon,
  LikedIcon,
  SettingsIcon,
  SpeakerIcon,
  SpeakerOffIcon,
} from './icons';
import Discovery from './screens/Discovery';
import Liked from './screens/Liked';
import SettingsSheet from './screens/SettingsSheet';
import Setup from './screens/Setup';
import { watchTheme } from './theme';
import { withTransition } from './transition';

const SCREENS: Record<Screen, ComponentType> = {
  setup: Setup,
  discovery: Discovery,
  liked: Liked,
};

// domMax is a lazy chunk: it is only fetched once the deck drives real motion.
const loadDomMax = () => import('./motion-features').then((module) => module.features);

export function App() {
  const screen = useStore((state) => state.screen);
  const setScreen = useStore((state) => state.setScreen);
  const hasSeeds = useStore((state) => state.seeds.length > 0);
  const isSettingsOpen = useStore((state) => state.settingsOpen);
  const setSettingsOpen = useStore((state) => state.setSettingsOpen);
  const storageNotice = useStore((state) => state.storageNotice);
  const dismissStorageNotice = useStore((state) => state.dismissStorageNotice);
  const theme = useStore((state) => state.settings.theme);
  const sound = useStore((state) => state.settings.sound);
  const setSettings = useStore((state) => state.setSettings);

  useEffect(() => watchTheme(theme), [theme]);

  // Sound off silences whatever is playing now, not only the next card.
  useEffect(() => {
    const player = previewPlayer();
    player.setMuted(!sound);
    if (!sound) player.stop();
  }, [sound]);

  const ScreenView = SCREENS[screen];
  // Setup lives inside the Discover flow: the tab stays lit while the user
  // picks seeds, and with no seeds Discover has nothing to deal, so it opens Setup.
  const discoverActive = screen === 'discovery' || screen === 'setup';

  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={loadDomMax} strict>
        <div className="app">
          <header className="app__header">
            <p className="app__brand">Music Tinder</p>
            <div className="app__actions">
              {screen === 'discovery' && hasSeeds && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={sound ? 'Sound on' : 'Sound off'}
                  aria-pressed={sound}
                  onClick={() => setSettings({ sound: !sound })}
                >
                  {sound ? <SpeakerIcon /> : <SpeakerOffIcon />}
                </button>
              )}
              <button
                type="button"
                className="icon-button"
                aria-label="Open settings"
                aria-haspopup="dialog"
                aria-expanded={isSettingsOpen}
                onClick={() => setSettingsOpen(true)}
              >
                <SettingsIcon />
              </button>
            </div>
          </header>

          {storageNotice && (
            <div className="notice" role="status">
              <span>{storageNotice}</span>
              <button
                type="button"
                className="icon-button"
                aria-label="Dismiss notice"
                onClick={dismissStorageNotice}
              >
                <CloseIcon />
              </button>
            </div>
          )}

          <main className="app__main">
            <ScreenView />
          </main>

          <nav className="tabbar" aria-label="Main">
            <button
              type="button"
              className="tabbar__button"
              aria-current={discoverActive ? 'page' : undefined}
              onClick={() => withTransition(() => setScreen(hasSeeds ? 'discovery' : 'setup'))}
            >
              <DiscoverIcon />
              Discover
            </button>
            <button
              type="button"
              className="tabbar__button"
              aria-current={screen === 'liked' ? 'page' : undefined}
              onClick={() => withTransition(() => setScreen('liked'))}
            >
              <LikedIcon />
              Liked
            </button>
          </nav>

          <SettingsSheet />
        </div>
      </LazyMotion>
    </MotionConfig>
  );
}
