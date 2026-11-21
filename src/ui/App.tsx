import { LazyMotion, MotionConfig } from 'motion/react';
import { useEffect, type ComponentType } from 'react';
import { useStore, type Screen } from '../store/store';
import { CloseIcon, DiscoverIcon, LikedIcon, SettingsIcon } from './icons';
import Discovery from './screens/Discovery';
import Liked from './screens/Liked';
import SettingsSheet from './screens/SettingsSheet';
import Setup from './screens/Setup';
import { watchTheme } from './theme';

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
  const isSettingsOpen = useStore((state) => state.settingsOpen);
  const setSettingsOpen = useStore((state) => state.setSettingsOpen);
  const storageNotice = useStore((state) => state.storageNotice);
  const dismissStorageNotice = useStore((state) => state.dismissStorageNotice);
  const theme = useStore((state) => state.settings.theme);

  useEffect(() => watchTheme(theme), [theme]);

  const ScreenView = SCREENS[screen];

  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={loadDomMax} strict>
        <div className="app">
          <header className="app__header">
            <p className="app__brand">Music Tinder</p>
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
              aria-current={screen === 'discovery' ? 'page' : undefined}
              onClick={() => setScreen('discovery')}
            >
              <DiscoverIcon />
              Discover
            </button>
            <button
              type="button"
              className="tabbar__button"
              aria-current={screen === 'liked' ? 'page' : undefined}
              onClick={() => setScreen('liked')}
            >
              <LikedIcon />
              Liked
            </button>
            <button
              type="button"
              className="tabbar__button"
              aria-haspopup="dialog"
              aria-expanded={isSettingsOpen}
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon />
              Settings
            </button>
          </nav>

          <SettingsSheet />
        </div>
      </LazyMotion>
    </MotionConfig>
  );
}
