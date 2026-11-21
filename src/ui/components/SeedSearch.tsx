import { useEffect, useRef, useState } from 'react';
import { createCatalog } from '../../catalog';
import { chipLabel } from '../../chips';
import { useStore } from '../../store/store';
import { CatalogError, type CatalogErrorKind, type Seed, type SeedCandidate } from '../../types';
import { Button } from '../Button';
import { ArtworkPlaceholder } from '../icons';

const catalog = createCatalog();
const DEBOUNCE_MS = 250;

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'results'; candidates: SeedCandidate[] }
  | { status: 'empty'; term: string }
  | { status: 'error'; term: string; kind: CatalogErrorKind };

const seedFrom = (candidate: SeedCandidate): Seed => ({
  id: `it:${candidate.kind}:${candidate.itunesId}`,
  kind: candidate.kind,
  name: candidate.name,
  ...(candidate.kind === 'artist'
    ? { itunesArtistId: candidate.itunesId }
    : { itunesCollectionId: candidate.itunesId }),
  chips: candidate.chips,
  creatorKey: candidate.creator.trim().toLowerCase(),
});

interface SeedSearchProps {
  type: 'artist' | 'album';
}

/** Debounced, race-safe name search that turns a picked hit into a stored seed. */
export function SeedSearch({ type }: SeedSearchProps) {
  const seeds = useStore((state) => state.seeds);
  const addSeed = useStore((state) => state.addSeed);
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState<SearchState>({ status: 'idle' });
  // Every term change invalidates older in-flight responses, so a slow answer
  // for a previous term can never overwrite the latest one.
  const sequence = useRef(0);

  useEffect(() => {
    const term = query.trim();
    sequence.current += 1;
    const current = sequence.current;
    if (term === '') return;

    const timer = setTimeout(() => {
      setSearch({ status: 'loading' });
      catalog.searchSeeds(term, type).then(
        (candidates) => {
          if (current !== sequence.current) return;
          setSearch(
            candidates.length > 0 ? { status: 'results', candidates } : { status: 'empty', term },
          );
        },
        (error: unknown) => {
          if (current !== sequence.current) return;
          const kind = error instanceof CatalogError ? error.kind : 'unknown';
          setSearch({ status: 'error', term, kind });
        },
      );
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, type, attempt]);

  const view: SearchState = query.trim() === '' ? { status: 'idle' } : search;

  const pick = (seed: Seed) => {
    if (!seeds.some((existing) => existing.id === seed.id)) addSeed(seed);
    setQuery('');
  };

  const labels = { artist: 'artists', album: 'albums' };

  return (
    <div className="seed-search">
      <input
        type="search"
        className="seed-search__input"
        aria-label={`Search ${labels[type]}`}
        placeholder={`Search ${labels[type]}`}
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {view.status === 'results' && (
        <ul className="seed-results" aria-label="Search results">
          {view.candidates.map((candidate) => {
            const seed = seedFrom(candidate);
            const added = seeds.some((existing) => existing.id === seed.id);
            const detail =
              candidate.kind === 'artist'
                ? candidate.chips.map(chipLabel).join(' · ')
                : [candidate.creator, candidate.year].filter(Boolean).join(' · ');
            const meta = added ? 'Added' : detail;
            return (
              <li key={seed.id}>
                <button
                  type="button"
                  className="seed-result"
                  disabled={added}
                  onClick={() => pick(seed)}
                >
                  <span className="seed-result__thumb">
                    {candidate.image ? (
                      <img src={candidate.image} alt="" />
                    ) : (
                      <ArtworkPlaceholder width={22} height={22} />
                    )}
                  </span>
                  <span className="seed-result__text">
                    <span className="seed-result__name">{candidate.name}</span>
                    <span className="seed-result__meta">{meta}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {view.status === 'empty' && (
        <p className="search-flag" role="status">
          No match for ‘{view.term}’
        </p>
      )}

      {view.status === 'error' && (
        <div className="search-flag search-flag--error" role="alert">
          <span>
            {view.kind === 'rate' ? 'Apple is limiting searches right now' : "Couldn't reach the catalog"}
          </span>
          <Button variant="secondary" onClick={() => setAttempt((count) => count + 1)}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
