import { useState } from 'react';
import { CHIPS, chipLabel } from '../../chips';
import { useStore } from '../../store/store';
import type { CardKind, Chip } from '../../types';
import { Button } from '../Button';
import { ChipToggle } from '../ChipToggle';
import { SeedSearch } from '../components/SeedSearch';
import { ArtworkPlaceholder, CloseIcon } from '../icons';

const SETUP_CHIPS = CHIPS.filter((chip) => chip.id !== 'other');

const CARD_TYPES: readonly { id: CardKind; label: string }[] = [
  { id: 'artist', label: 'Artists' },
  { id: 'album', label: 'Albums' },
  { id: 'song', label: 'Songs' },
];

const SEARCH_SCOPES: readonly { id: 'artist' | 'album'; label: string }[] = [
  { id: 'artist', label: 'Artists' },
  { id: 'album', label: 'Albums' },
];

const genreSeedId = (chip: Chip) => `genre:${chip}`;

export default function Setup() {
  const seeds = useStore((state) => state.seeds);
  const addSeed = useStore((state) => state.addSeed);
  const removeSeed = useStore((state) => state.removeSeed);
  const cardType = useStore((state) => state.settings.cardType);
  const setSettings = useStore((state) => state.setSettings);
  const setScreen = useStore((state) => state.setScreen);
  // Searching and what the deck deals are separate decisions: the scope only
  // picks which catalog the field searches.
  const [searchScope, setSearchScope] = useState<'artist' | 'album'>('artist');

  const isChipSelected = (chip: Chip) =>
    seeds.some((seed) => seed.id === genreSeedId(chip));

  const toggleChip = (chip: Chip) => {
    if (isChipSelected(chip)) {
      removeSeed(genreSeedId(chip));
      return;
    }
    addSeed({ id: genreSeedId(chip), kind: 'genre', name: chipLabel(chip), chips: [chip] });
  };

  // Genre chips are their own selection UI; the pills show the searched seeds.
  const chosenSeeds = seeds.filter((seed) => seed.kind !== 'genre');
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

      <section className="setup__section" aria-labelledby="setup-search-label">
        <h2 id="setup-search-label" className="setup__label">
          Add a seed
        </h2>
        <div className="segmented" role="radiogroup" aria-label="Search scope">
          {SEARCH_SCOPES.map((scope) => (
            <label key={scope.id} className="segmented__option">
              <input
                type="radio"
                name="seed-scope"
                value={scope.id}
                checked={searchScope === scope.id}
                onChange={() => setSearchScope(scope.id)}
              />
              <span>{scope.label}</span>
            </label>
          ))}
        </div>
        <SeedSearch type={searchScope} />

        {chosenSeeds.length > 0 && (
          <ul className="seed-pills" aria-label="Your seeds">
            {chosenSeeds.map((seed) => (
              <li key={seed.id} className="seed-pill">
                <span className="seed-pill__thumb" aria-hidden="true">
                  <ArtworkPlaceholder width={24} height={24} />
                </span>
                <span className="seed-pill__name">{seed.name}</span>
                <button
                  type="button"
                  className="seed-pill__remove"
                  aria-label={`Remove ${seed.name}`}
                  onClick={() => removeSeed(seed.id)}
                >
                  <CloseIcon width={16} height={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="setup__section" aria-labelledby="setup-genres-label">
        <h2 id="setup-genres-label" className="setup__label">
          Genres you like
        </h2>
        <div className="chip-grid" role="group" aria-labelledby="setup-genres-label">
          {SETUP_CHIPS.map((chip) => (
            <ChipToggle
              key={chip.id}
              label={chip.label}
              selected={isChipSelected(chip.id)}
              onToggle={() => toggleChip(chip.id)}
            />
          ))}
        </div>
      </section>

      <section className="setup__section" aria-labelledby="setup-type-label">
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
      </section>

      <div className="setup__footer">
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
