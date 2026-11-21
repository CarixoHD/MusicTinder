import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

export function DiscoverIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
    </svg>
  );
}

export function LikedIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.6-7 9-7 9Z" />
    </svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 7h8M17 7h3M4 17h3M12 17h8" />
      <circle cx="14.5" cy="7" r="2.2" />
      <circle cx="9.5" cy="17" r="2.2" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

export function SpeakerIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 9.5h3l4-3.5v12l-4-3.5H4z" />
      <path d="M15 8.8a4.5 4.5 0 0 1 0 6.4M17.7 6.2a8 8 0 0 1 0 11.6" />
    </svg>
  );
}

export function SpeakerOffIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 9.5h3l4-3.5v12l-4-3.5H4z" />
      <path d="m15.5 9.5 5 5M20.5 9.5l-5 5" />
    </svg>
  );
}

/** The catalog can't be reached: a cloud with a slash, not a sad face. */
export function CloudOffIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6.5 18a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 17.7 10a3.5 3.5 0 0 1-.2 7H6.5Z" />
      <path d="m4 4 16 16" />
    </svg>
  );
}

/** Neutral artwork placeholder: a quiet vinyl, never a broken image. */
export function ArtworkPlaceholder(props: IconProps) {
  return (
    <svg {...base} width={64} height={64} strokeWidth={1} {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.2" />
      <circle cx="12" cy="12" r="0.6" />
    </svg>
  );
}
