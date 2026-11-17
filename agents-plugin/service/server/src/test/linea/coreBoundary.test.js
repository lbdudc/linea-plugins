import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '../..');
const ADAPTER = path.join(SRC, 'linea', 'featureModel.js');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});

test('@lbdudc/linea-core is imported by the adapter and by nothing else in src/', () => {
  const importers = walk(SRC)
    .filter((file) => file.endsWith('.js') && !file.includes(`${path.sep}test${path.sep}`))
    .filter((file) => /from\s+['"]@lbdudc\/linea-core['"]/.test(fs.readFileSync(file, 'utf8')));

  expect(importers).toEqual([ADAPTER]);
});
