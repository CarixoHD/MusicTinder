import { CheckIcon } from './icons';

interface ChipToggleProps {
  label: string;
  selected: boolean;
  onToggle: () => void;
}

export function ChipToggle({ label, selected, onToggle }: ChipToggleProps) {
  return (
    <button type="button" className="chip" aria-pressed={selected} onClick={onToggle}>
      {selected && <CheckIcon className="chip__check" width={12} height={12} />}
      {label}
    </button>
  );
}
