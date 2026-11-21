import { useState } from 'react';
import { CHIPS, chipLabel } from '../../chips';
import { useStore } from '../../store/store';
import type { Chip } from '../../types';
import { Button } from '../Button';
import { ChipToggle } from '../ChipToggle';

// Placeholder picker: genre chips seed the store; artist/album search is the next slice.
const SETUP_CHIPS = CHIPS.filter((chip) => chip.id !== 'other').slice(0, 12);

export default function Setup() {
  const addSeed = useStore((state) => state.addSeed);
  const setScreen = useStore((state) => state.setScreen);
  const [selected, setSelected] = useState<Chip[]>([]);

  const toggle = (chip: Chip) =>
    setSelected((current) =>
      current.includes(chip) ? current.filter((item) => item !== chip) : [...current, chip],
    );

  const continueToDeck = () => {
    for (const chip of selected) {
      addSeed({ id: `genre:${chip}`, kind: 'genre', name: chipLabel(chip), chips: [chip] });
    }
    setScreen('discovery');
  };

  return (
    <section className="screen" aria-labelledby="setup-title">
      <div className="screen__intro">
        <h1 id="setup-title" className="screen__title">
          Find something new
        </h1>
        <p className="screen__body">
          Start with a few genres you already love. Artist and album search is on its way.
        </p>
      </div>

      <div className="chip-grid" role="group" aria-label="Genres">
        {SETUP_CHIPS.map((chip) => (
          <ChipToggle
            key={chip.id}
            label={chip.label}
            selected={selected.includes(chip.id)}
            onToggle={() => toggle(chip.id)}
          />
        ))}
      </div>

      <div className="screen__actions">
        <Button variant="primary" disabled={selected.length === 0} onClick={continueToDeck}>
          Continue
        </Button>
      </div>
    </section>
  );
}
