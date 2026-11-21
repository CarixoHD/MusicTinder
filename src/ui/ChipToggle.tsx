interface ChipToggleProps {
  label: string;
  selected: boolean;
  onToggle: () => void;
}

export function ChipToggle({ label, selected, onToggle }: ChipToggleProps) {
  return (
    <button type="button" className="chip" aria-pressed={selected} onClick={onToggle}>
      {label}
    </button>
  );
}
