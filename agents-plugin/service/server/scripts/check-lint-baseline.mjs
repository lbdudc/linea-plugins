/**
 * check-lint-baseline.mjs
 *
 * Corre el mismo lint que `npm run lint` y compara el total de errores contra
 * `LINT_BASELINE`. Falla solo si SUBE.
 *
 * Existe porque `npm run lint` ya está en rojo por diseño: los 120 errores
 * actuales son preexistentes, en ficheros copiados byte a byte de
 * `linea/server`, y arreglarlos sería dejar de ser una copia fiel. Con el
 * booleano "hay errores" siempre en true, un PR podría añadir errores nuevos
 * sin que nadie lo notara; por eso se vigila la cifra y no se excluye `src/`
 * del lint (una exclusión así nunca se retira).
 *
 * La cifra vive aquí y en ningún otro sitio: un markdown en prosa no es fuente
 * fiable para un script.
 *
 * Uso:  node scripts/check-lint-baseline.mjs
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..');

// `npx eslint . --no-eslintrc -c .eslintrc.cjs -f json` el 2026-09-14, todos
const LINT_BASELINE = 82;

function runEslintJson() {
  // eslint no lo necesita) y es más rápido al no pasar por la resolución de
  const eslintBin = path.join(serverDir, 'node_modules', '.bin', process.platform === 'win32' ? 'eslint.cmd' : 'eslint');
  let stdout;
  try {
    stdout = execFileSync(
      eslintBin,
      ['.', '--no-eslintrc', '-c', '.eslintrc.cjs', '-f', 'json'],
      { cwd: serverDir, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64, shell: process.platform === 'win32' }
    );
  } catch (err) {
    if (typeof err.stdout === 'string' && err.stdout.length > 0) {
      stdout = err.stdout;
    } else {
      throw err;
    }
  }
  return JSON.parse(stdout);
}

function main() {
  const results = runEslintJson();

  let totalErrors = 0;
  let totalWarnings = 0;
  const perFile = [];

  for (const file of results) {
    if (file.errorCount === 0 && file.warningCount === 0) continue;
    totalErrors += file.errorCount;
    totalWarnings += file.warningCount;
    perFile.push({ file: path.relative(serverDir, file.filePath), errors: file.errorCount, warnings: file.warningCount });
  }

  console.log(`[check-lint-baseline] total actual: ${totalErrors} errores, ${totalWarnings} warnings (baseline: ${LINT_BASELINE} errores).`);
  console.log(`[check-lint-baseline] ${perFile.length} fichero(s) con avisos:`);
  for (const f of perFile.sort((a, b) => b.errors - a.errors)) {
    console.log(`  - ${f.file}: ${f.errors} error(es), ${f.warnings} warning(s)`);
  }

  if (totalErrors > LINT_BASELINE) {
    throw new Error(
      `[check-lint-baseline] SUBIÓ: ${totalErrors} errores > baseline ${LINT_BASELINE}. ` +
      'El desglose de arriba dice en qué ficheros; los nuevos son los que no estaban en la copia de linea/server.'
    );
  }

  if (totalErrors < LINT_BASELINE) {
    console.log(`\n[check-lint-baseline] OK — ${totalErrors} <= ${LINT_BASELINE} (bajó respecto al baseline; si es estable, actualiza LINT_BASELINE aquí).`);
  } else {
    console.log(`\n[check-lint-baseline] OK — ${totalErrors} == ${LINT_BASELINE}, sin cambios respecto al baseline conocido.`);
  }
}

main();
