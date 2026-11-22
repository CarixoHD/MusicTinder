import { useId, useState } from 'react';
import { CHIPS, chipLabel } from '../../chips';
import { useStore } from '../../store/store';
import type { Chip } from '../../types';
import { ChipToggle } from '../ChipToggle';
import { CloseIcon } from '../icons';
import { SeedArtwork, SeedSearch } from './SeedSearch';

const SETUP_CHIPS = CHIPS.filter((chip) => chip.id !== 'other');

const SEARCH_SCOPES: readonly { id: 'artist' | 'album'; label: string }[] = [
  { id: 'artist', label: 'Artists' },
  { id: 'album', label: 'Albums' },
];

const genreSeedId = (chip: Chip) => `genre:${chip}`;

/**
 * Setup's seed picking: the Artists|Albums search scope, the picked seeds with
 * their artwork, and the genre chips. Setup and the in-deck seeds sheet share
 * this, so the ids come from useId and stay unique if both are mounted.
 */
export function SeedEditor() {
  const seeds = useStore((state) => state.seeds);
  const addSeed = useStore((state) => state.addSeed);
  const removeSeed = useStore((state) => state.removeSeed);
  // Searching and what the deck deals are separate decisions: the scope only
  // picks which catalog the field searches.
  const [searchScope, setSearchScope] = useState<'artist' | 'album'>('artist');
  const searchLabelId = useId();
  const genresLabelId = useId();
  // Also unique so a second editor (the in-deck sheet) never joins this group.
  const scopeName = useId();

  const isChipSelected = (chip: Chip) => seeds.some((seed) => seed.id === genreSeedId(chip));

  const toggleChip = (chip: Chip) => {
    if (isChipSelected(chip)) {
      removeSeed(genreSeedId(chip));
      return;
    }
    addSeed({ id: genreSeedId(chip), kind: 'genre', name: chipLabel(chip), chips: [chip] });
  };

  // Genre chips are their own selection UI; the pills show the searched seeds.
  const chosenSeeds = seeds.filter((seed) => seed.kind !== 'genre');

  return (
    <>
      <section className="setup__section" aria-labelledby={searchLabelId}>
        <h2 id={searchLabelId} className="setup__label">
          Add a seed
        </h2>
        <div className="segmented" role="radiogroup" aria-label="Search scope">
          {SEARCH_SCOPES.map((scope) => (
            <label key={scope.id} className="segmented__option">
              <input
                type="radio"
                name={scopeName}
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
                  <SeedArtwork src={seed.image} size={24} />
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

      <section className="setup__section" aria-labelledby={genresLabelId}>
        <h2 id={genresLabelId} className="setup__label">
          Genres you like
        </h2>
        <div className="chip-grid" role="group" aria-labelledby={genresLabelId}>
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
    </>
  );
}
