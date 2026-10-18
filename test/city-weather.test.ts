import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { getCityWeather } from '../client/src/cityWeather';

test('Persian calendar months select the correct city season', () => {
  const cases = [
    ['1405-01', 'spring'], ['1405-03', 'spring'],
    ['1405-04', 'summer'], ['1405-06', 'summer'],
    ['1405-07', 'autumn'], ['1405-09', 'autumn'],
    ['1405-10', 'winter'], ['1405-12', 'winter'],
  ] as const;
  for (const [period, season] of cases) assert.equal(getCityWeather(period, 'city-1').season, season);
});

test('weather is repeatable and appropriate to the season', () => {
  const allowed = {
    spring: ['partly-cloudy', 'sunny', 'rainy'],
    summer: ['sunny', 'partly-cloudy', 'windy'],
    autumn: ['partly-cloudy', 'rainy', 'windy'],
    winter: ['snowy', 'partly-cloudy', 'rainy'],
  };
  for (let month = 1; month <= 12; month += 1) {
    const period = `1405-${String(month).padStart(2, '0')}`;
    const forecast = getCityWeather(period, 'city-1');
    assert.deepEqual(forecast, getCityWeather(period, 'city-1'));
    assert.ok(allowed[forecast.season].includes(forecast.kind));
  }
});
