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

const genreSeedId = (chip: Chip) => `genre:${chip}`;

export default function Setup() {
  const seeds = useStore((state) => state.seeds);
  const addSeed = useStore((state) => state.addSeed);
  const removeSeed = useStore((state) => state.removeSeed);
  const cardType = useStore((state) => state.settings.cardType);
  const setSettings = useStore((state) => state.setSettings);
  const setScreen = useStore((state) => state.setScreen);

  const isChipSelected = (chip: Chip) =>
    seeds.some((seed) => seed.id === genreSeedId(chip));

  const toggleChip = (chip: Chip) => {
    if (isChipSelected(chip)) {
      removeSeed(genreSeedId(chip));
      return;
    }
    addSeed({ id: genreSeedId(chip), kind: 'genre', name: chipLabel(chip), chips: [chip] });
  };

  const chosenSeeds = seeds.filter((seed) => seed.kind !== 'genre');
  // Songs are found from artists, so the picker searches artists for that mood.
  const searchType = cardType === 'album' ? 'album' : 'artist';

  return (
    <section className="screen" aria-labelledby="setup-title">
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
          {cardType === 'album' ? 'Add an album' : 'Add an artist'}
        </h2>
        <SeedSearch type={searchType} />
      </section>

      <section className="setup__section" aria-labelledby="setup-type-label">
        <h2 id="setup-type-label" className="setup__label">
          Show me
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

      {chosenSeeds.length > 0 && (
        <section className="setup__section" aria-labelledby="setup-seeds-label">
          <h2 id="setup-seeds-label" className="setup__label">
            Your seeds
          </h2>
          <ul className="seed-list">
            {chosenSeeds.map((seed) => (
              <li key={seed.id} className="seed-row">
                <span className="seed-row__thumb" aria-hidden="true">
                  <ArtworkPlaceholder width={22} height={22} />
                </span>
                <span className="seed-row__text">
                  <span className="seed-row__name">{seed.name}</span>
                  <span className="seed-row__meta">{seed.kind === 'artist' ? 'Artist' : 'Album'}</span>
                </span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${seed.name}`}
                  onClick={() => removeSeed(seed.id)}
                >
                  <CloseIcon />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="screen__actions">
        <Button
          variant="primary"
          disabled={seeds.length === 0}
          onClick={() => setScreen('discovery')}
        >
          Start discovering
        </Button>
      </div>
    </section>
  );
}
