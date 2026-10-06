import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

/** Shared app icons keep the home and trade surfaces visually identical. */
export function SettingsGearIcon(props: IconProps) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="m9.7 3.5.5-1h3.6l.5 1 1 .5 1.1-.2 2.5 2.5-.2 1.1.5 1 1 .5v3.6l-1 .5-.5 1 .2 1.1-2.5 2.5-1.1-.2-1 .5-.5 1h-3.6l-.5-1-1-.5-1.1.2-2.5-2.5.2-1.1-.5-1-1-.5V8.9l1-.5.5-1-.2-1.1 2.5-2.5 1.1.2 1-.5Z" strokeWidth="1.7" />
    <circle cx="12" cy="10.7" r="2.5" strokeWidth="1.7" />
  </svg>;
}

/** Two hollow candlesticks with wicks, matching the RN K-line entry icon. */
export function KlineCandlestickIcon(props: IconProps) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M7 3v4M7 17v4M4.5 7h5v10h-5zM17 2v5M17 15v7M14.5 7h5v8h-5z" strokeWidth="1.8" />
  </svg>;
}

export function SecurityShieldIcon(props: IconProps) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M12 2.8 19 6v5.1c0 4.5-2.8 8.2-7 10.1-4.2-1.9-7-5.6-7-10.1V6l7-3.2Z" strokeWidth="1.8" />
    <path d="m8.8 12 2.1 2.1 4.4-4.5" strokeWidth="1.8" />
  </svg>;
}

export function SuccessCheckIcon(props: IconProps) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d="m5 12.5 4.2 4.2L19 7" strokeWidth="2.4" /></svg>;
}
