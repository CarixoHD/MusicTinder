import { useEffect, useRef, useState } from 'react';
import { createCatalog } from '../../catalog';
import { chipLabel } from '../../chips';
import { useStore } from '../../store/store';
import {
  CatalogError,
  type Catalog,
  type CatalogErrorKind,
  type Seed,
  type SeedCandidate,
} from '../../types';
import { Button } from '../Button';
import { ArtworkPlaceholder } from '../icons';

const defaultCatalog = createCatalog();
const DEBOUNCE_MS = 400;
/** One character matches too much to be worth a request. */
const MIN_TERM_LENGTH = 2;

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'results'; term: string; candidates: SeedCandidate[] }
  | { status: 'empty'; term: string }
  | { status: 'error'; term: string; kind: CatalogErrorKind };

/** 18_400 → "18k fans"; the count tells duplicate Deezer profiles apart. */
const fanLabel = (fans: number): string =>
  fans >= 1_000_000
    ? `${Number((fans / 1_000_000).toFixed(1))}m fans`
    : fans >= 1_000
      ? `${Math.round(fans / 1_000)}k fans`
      : `${fans} fans`;

const seedFrom = (candidate: SeedCandidate): Seed | null => {
  const base = {
    kind: candidate.kind,
    name: candidate.name,
    chips: candidate.chips,
    creatorKey: candidate.creator.trim().toLowerCase(),
  };

  if (candidate.deezerArtistId !== undefined) {
    return {
      ...base,
      id: `dz:artist:${candidate.deezerArtistId}`,
      deezerArtistId: candidate.deezerArtistId,
    };
  }

  const itunesId = candidate.itunesId;
  if (itunesId === undefined) return null;
  return {
    ...base,
    id: `it:${candidate.kind}:${itunesId}`,
    ...(candidate.kind === 'artist'
      ? { itunesArtistId: itunesId }
      : { itunesCollectionId: itunesId }),
  };
};

interface SeedSearchProps {
  type: 'artist' | 'album';
  /** Tests inject a fixture; the app uses the composed catalog. */
  catalog?: Catalog;
}

/** Debounced, race-safe name search that turns a picked hit into a stored seed. */
export function SeedSearch({ type, catalog = defaultCatalog }: SeedSearchProps) {
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
    if (term.length < MIN_TERM_LENGTH) return;

    // Setup waits for a budget refill (the row says "Searching") and abandons
    // the wait as soon as the term changes.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      catalog.searchSeeds(term, type, { wait: true, signal: controller.signal }).then(
        (candidates) => {
          if (current !== sequence.current) return;
          setSearch(
            candidates.length > 0
              ? { status: 'results', term, candidates }
              : { status: 'empty', term },
          );
        },
        (error: unknown) => {
          if (current !== sequence.current) return;
          const kind = error instanceof CatalogError ? error.kind : 'unknown';
          setSearch({ status: 'error', term, kind });
        },
      );
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, type, attempt, catalog]);

  const term = query.trim();
  // Results belong to the term that answered them; a newer term (or none yet)
  // shows the loading row instead of the previous term's answer.
  const view: SearchState =
    term.length < MIN_TERM_LENGTH
      ? { status: 'idle' }
      : 'term' in search && search.term === term
        ? search
        : { status: 'loading' };

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

      {view.status === 'loading' && (
        <p className="search-flag" role="status">
          Searching…
        </p>
      )}

      {view.status === 'results' && (
        <ul className="seed-results" aria-label="Search results">
          {view.candidates.flatMap((candidate) => {
            const seed = seedFrom(candidate);
            if (seed === null) return [];
            const added = seeds.some((existing) => existing.id === seed.id);
            const detail =
              candidate.kind === 'artist'
                ? candidate.fans !== undefined
                  ? fanLabel(candidate.fans)
                  : candidate.chips.map(chipLabel).join(' · ')
                : [candidate.creator, candidate.year].filter(Boolean).join(' · ');
            const meta = added ? 'Added' : detail;
            return [
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
              </li>,
            ];
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
            {view.kind === 'rate' ? 'Apple is limiting searches right now' : 'Couldn’t reach the catalog'}
          </span>
          <Button variant="secondary" onClick={() => setAttempt((count) => count + 1)}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
