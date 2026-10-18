import type { CityWeather } from './cityWeather';

export function CityWeatherIcon({ weather }: { weather: CityWeather }) {
  const { kind, season } = weather;
  const hasSun = kind === 'sunny' || kind === 'partly-cloudy';
  const hasCloud = kind === 'partly-cloudy' || kind === 'rainy' || kind === 'snowy';
  return <svg className={`city-weather-icon season-${season} weather-${kind}`} viewBox="0 0 40 40" width="38" height="38" aria-hidden="true" focusable="false">
    <circle className="weather-disc" cx="20" cy="20" r="18" />
    <path className="weather-season-ring" d="M8 30a16 16 0 0 0 24 0" />
    {hasSun && <g className="weather-sun">
      <path d="M24 5v3M24 20v3M15 14h3M30 14h3M17.6 7.6l2.1 2.1M28.3 18.3l2.1 2.1M30.4 7.6l-2.1 2.1M19.7 18.3l-2.1 2.1" />
      <circle cx="24" cy="14" r="5.1" />
    </g>}
    {hasCloud && <path className="weather-cloud" d="M10.5 23.5c-2.6 0-4.5-1.9-4.5-4.2 0-2.3 1.8-4.1 4.1-4.2.9-3.8 4.2-6.5 8.1-6.5 3.7 0 6.7 2.3 7.8 5.7 3.5 0 6.1 2.5 6.1 5.8 0 3-2.3 5.4-5.5 5.4H10.5Z" />}
    {kind === 'rainy' && <g className="weather-precipitation weather-rain"><path d="m12 27-2 4M21 27l-2 4M29 27l-2 4" /></g>}
    {kind === 'snowy' && <g className="weather-precipitation weather-snow"><path d="M13 27v5m-2.5-2.5h5m11.5-2.5v5m-2.5-2.5h5" /></g>}
    {kind === 'windy' && <g className="weather-wind"><path d="M7 15h20c4 0 4-5 1-5-1 0-2 .5-2.5 1.6M5 21h27M10 27h17c4 0 4 5 1 5-1 0-2-.5-2.5-1.6" /></g>}
    {kind === 'sunny' && <path className="weather-city" d="m11 31 9-8 9 8H11Z" />}
    {season === 'spring' && <g className="weather-season-detail weather-flower"><circle cx="8" cy="31" r="2"/><circle cx="13" cy="31" r="2"/><circle cx="10.5" cy="28.5" r="2"/><circle cx="10.5" cy="33.5" r="2"/><circle className="flower-center" cx="10.5" cy="31" r="1.5"/></g>}
    {season === 'summer' && <path className="weather-season-detail weather-summer-ray" d="m7 30 3-2m-5-3 4-.5M31 29l3 2" />}
    {season === 'autumn' && <path className="weather-season-detail weather-leaf" d="M7 29c1-4 5-5 8-4-1 4-4 7-8 4Zm0 0 7-4" />}
    {season === 'winter' && <path className="weather-season-detail weather-frost" d="M8 29v6m-3-3h6m-5-5 4 9m0-9-4 9" />}
  </svg>;
}
