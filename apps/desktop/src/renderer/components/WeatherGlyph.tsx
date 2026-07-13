import React from 'react';

/**
 * E5 inline SVG weather icon set: sun, partly cloudy, cloud, rain, snow, storm,
 * fog — one 24px outline style, currentColor stroke. Maps WMO condition text
 * (from weather tools) to a glyph.
 */
export type Glyph = 'sun' | 'partly' | 'cloud' | 'rain' | 'snow' | 'storm' | 'fog';

export function glyphFor(condition: string): Glyph {
  const c = condition.toLowerCase();
  if (c.includes('thunder') || c.includes('storm')) return 'storm';
  if (c.includes('snow') || c.includes('grains')) return 'snow';
  if (c.includes('rain') || c.includes('drizzle') || c.includes('shower')) return 'rain';
  if (c.includes('fog') || c.includes('rime')) return 'fog';
  if (c.includes('overcast') || c === 'cloudy') return 'cloud';
  if (c.includes('cloud')) return 'partly';
  return 'sun';
}

export function WeatherGlyph({ condition, size = 24 }: { condition: string; size?: number }): React.JSX.Element {
  const g = glyphFor(condition);
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-label': condition,
    role: 'img' as const,
  };
  switch (g) {
    case 'sun':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
            const r = (a * Math.PI) / 180;
            return <line key={a} x1={12 + Math.cos(r) * 7} y1={12 + Math.sin(r) * 7} x2={12 + Math.cos(r) * 9.5} y2={12 + Math.sin(r) * 9.5} />;
          })}
        </svg>
      );
    case 'partly':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="3" />
          <path d="M6 16h9a3.5 3.5 0 0 0 .3-7A5 5 0 0 0 6 11a3 3 0 0 0 0 5Z" />
        </svg>
      );
    case 'cloud':
      return (
        <svg {...common}>
          <path d="M7 18h9a4 4 0 0 0 .3-8A5.5 5.5 0 0 0 6 11.5 3.5 3.5 0 0 0 7 18Z" />
        </svg>
      );
    case 'rain':
      return (
        <svg {...common}>
          <path d="M7 14h9a4 4 0 0 0 .3-8A5.5 5.5 0 0 0 6 7.5 3.5 3.5 0 0 0 7 14Z" />
          <line x1="8" y1="17" x2="7" y2="20" />
          <line x1="12" y1="17" x2="11" y2="20" />
          <line x1="16" y1="17" x2="15" y2="20" />
        </svg>
      );
    case 'snow':
      return (
        <svg {...common}>
          <path d="M7 14h9a4 4 0 0 0 .3-8A5.5 5.5 0 0 0 6 7.5 3.5 3.5 0 0 0 7 14Z" />
          <circle cx="8" cy="18.5" r="0.6" fill="currentColor" />
          <circle cx="12" cy="19.5" r="0.6" fill="currentColor" />
          <circle cx="16" cy="18.5" r="0.6" fill="currentColor" />
        </svg>
      );
    case 'storm':
      return (
        <svg {...common}>
          <path d="M7 13h9a4 4 0 0 0 .3-8A5.5 5.5 0 0 0 6 6.5 3.5 3.5 0 0 0 7 13Z" />
          <path d="M12 15l-2 3.5h3L11 22" />
        </svg>
      );
    case 'fog':
      return (
        <svg {...common}>
          <path d="M7 11h9a4 4 0 0 0 .3-8A5.5 5.5 0 0 0 6 4.5 3.5 3.5 0 0 0 7 11Z" />
          <line x1="5" y1="15" x2="19" y2="15" />
          <line x1="7" y1="18" x2="17" y2="18" />
        </svg>
      );
  }
}
