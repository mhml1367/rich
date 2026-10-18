import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

test('game surface and backend expose no wagering mechanics or gambling route copy', async () => {
  const files = ['client/src/App.tsx', 'src/rooms/room.controller.ts', 'src/rooms/room.service.ts', 'src/game/systems.ts'];
  const sources = await Promise.all(files.map(file => readFile(resolve(process.cwd(), file), 'utf8')));
  const prohibited = /\b(?:casino|roulette|wager(?:ing)?|betting|slot machine|lottery)\b|قمار|شرط.?بندی|کازینو|اسلات|رولت/i;
  for (const [index, source] of sources.entries()) assert.doesNotMatch(source, prohibited, files[index]);
});

test('Pixi city renderer keeps a mobile frame cap, bounded pixel ratio, cleanup, and reduced-motion support', async () => {
  const source = await readFile(resolve(process.cwd(), 'client/src/PixiCity.tsx'), 'utf8');
  assert.match(source, /Math\.min\(devicePixelRatio\s*\|\|\s*1,\s*2\)/);
  assert.match(source, /app\.ticker\.maxFPS\s*=\s*60/);
  assert.match(source, /motionEnabled\s*=\s*\(\)\s*=>\s*!reducedMotionRef\.current\s*&&\s*!systemMotionPreference\.matches/);
  assert.match(source, /app\.destroy\(true/);
});
