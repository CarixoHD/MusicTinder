import { useStore } from '../../store/store';
import type { CardKind } from '../../types';
import { Button } from '../Button';
import { SeedEditor } from '../components/SeedEditor';

const CARD_TYPES: readonly { id: CardKind; label: string }[] = [
  { id: 'artist', label: 'Artists' },
  { id: 'album', label: 'Albums' },
  { id: 'song', label: 'Songs' },
];

export default function Setup() {
  const seeds = useStore((state) => state.seeds);
  const cardType = useStore((state) => state.settings.cardType);
  const setSettings = useStore((state) => state.setSettings);
  const setScreen = useStore((state) => state.setScreen);

  const seedCount = seeds.length;
  const startLabel =
    seedCount === 0
      ? 'Start discovering'
      : `Start discovering with ${seedCount} seed${seedCount === 1 ? '' : 's'}`;

  return (
    <section className="screen screen--setup" aria-labelledby="setup-title">
      <div className="screen__intro">
        <h1 id="setup-title" className="screen__title">
          Find something new
        </h1>
        <p className="screen__body">
          Pick a few artists, albums or genres you already love. The deck starts there.
        </p>
      </div>

      <SeedEditor />

      {/* The last step, pinned above the tab bar: what to deal, then start. */}
      <div className="setup__footer">
        <div className="setup__deal">
          <h2 id="setup-type-label" className="setup__label">
            Deal me
          </h2>
          <div className="segmented" role="group" aria-labelledby="setup-type-label">
            {CARD_TYPES.map((type) => (
              <button
                key={type.id}
                type="button"
                className="segmented__button"
                aria-pressed={cardType === type.id}
                onClick={() => setSettings({ cardType: type.id })}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>
        <Button
          variant="primary"
          className="setup__start"
          disabled={seedCount === 0}
          onClick={() => setScreen('discovery')}
        >
          {startLabel}
        </Button>
      </div>
    </section>
  );
}
