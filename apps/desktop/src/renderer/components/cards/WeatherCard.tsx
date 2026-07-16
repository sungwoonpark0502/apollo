import React from 'react';
import { fmtDateIso, type WeatherDay, type WeatherNow } from '@apollo/shared';

export function WeatherCard({ place, now, days }: { place: string; now: WeatherNow; days: WeatherDay[] }): React.JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>{place}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-3)', margin: 'var(--sp-1) 0 var(--sp-3)' }}>
        <span style={{ fontSize: 32, fontWeight: 600 }}>{now.tempF}°</span>
        <span style={{ color: 'var(--text-2)' }}>{now.condition}</span>
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>feels {now.feelsF}°</span>
      </div>
      <div style={{ display: 'flex', gap: 'var(--sp-4)' }}>
        {days.slice(0, 4).map((d) => (
          <div key={d.dateIso} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
              {fmtDateIso(d.dateIso, 'weekday-short')}
            </div>
            <div style={{ fontSize: 'var(--fs-caption)' }}>
              {d.hiF}° <span style={{ color: 'var(--text-3)' }}>{d.loF}°</span>
            </div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>{d.condition}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
