#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..');

const packageJsonPath = path.join(serverDir, 'package.json');
const lockfilePath = path.join(serverDir, 'package-lock.json');
const patchesDir = path.join(serverDir, 'patches');

// resto de devDependencies (eslint y sus plugins, nodemon, patch-package,
// prettier, vitest) son herramientas de CLI que se invocan por su binario
const IMPORTABLE_DEV_DEPENDENCIES = new Set(['bcrypt', 'mongodb-memory-server', 'supertest']);

function run(cmd, args, cwd) {
  console.log(`\n$ ${cmd} ${args.join(' ')}  (cwd=${cwd})`);
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    throw new Error(`Comando falló (exit ${result.status}): ${cmd} ${args.join(' ')}`);
  }
}

function main() {
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`No existe ${packageJsonPath}`);
  }
  if (!fs.existsSync(lockfilePath)) {
    throw new Error(
      `No existe ${lockfilePath}. \`npm ci\` necesita un package-lock.json ya generado: ` +
      `corre \`npm install\` una vez en ${serverDir} (en un entorno que permita instalar la ` +
      `dependencia git de linea-core) para crearlo y commitéalo, y vuelve a lanzar este script.`
    );
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const allDeclared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if (Object.keys(allDeclared).length === 0) {
    throw new Error('package.json no declara ninguna dependencia — nada que comprobar.');
  }

  const depNames = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}).filter((n) => IMPORTABLE_DEV_DEPENDENCIES.has(n)),
  ];

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-agents-check-install-'));
  console.log(`[check-install] directorio temporal: ${tmpDir}`);

  try {
    fs.copyFileSync(packageJsonPath, path.join(tmpDir, 'package.json'));
    fs.copyFileSync(lockfilePath, path.join(tmpDir, 'package-lock.json'));
    if (fs.existsSync(patchesDir)) {
      fs.cpSync(patchesDir, path.join(tmpDir, 'patches'), { recursive: true });
    }

    run('npm', ['ci', '--no-audit', '--no-fund'], tmpDir);

    const runnerPath = path.join(tmpDir, '__verify-imports.mjs');
    const runnerSrc = `
const names = ${JSON.stringify(depNames)};
const failures = [];
for (const name of names) {
  try {
    await import(name);
  } catch (err) {
    failures.push({ name, message: err && err.message ? err.message : String(err) });
  }
}
if (failures.length > 0) {
  console.error('IMPORT_FAILURES=' + JSON.stringify(failures));
  process.exit(1);
}
console.log('IMPORT_OK');
`;
    fs.writeFileSync(runnerPath, runnerSrc);

    const result = spawnSync('node', ['__verify-imports.mjs'], { cwd: tmpDir, encoding: 'utf8' });
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');

    if (result.status !== 0) {
      const match = /IMPORT_FAILURES=(.+)/.exec(result.stderr ?? result.stdout ?? '');
      if (match) {
        const failures = JSON.parse(match[1]);
        console.error(`\n[check-install] ${failures.length} dependencia(s) declaradas no se pudieron importar:`);
        for (const f of failures) console.error(`  - ${f.name}: ${f.message}`);
      }
      throw new Error('Alguna dependencia declarada en package.json no se puede import()ar tras `npm ci`.');
    }

    console.log(`\n[check-install] OK — npm ci limpio y las ${depNames.length} dependencias declaradas importan correctamente.`);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
    } catch (err) {
      console.warn(`[check-install] aviso: no se pudo borrar el directorio temporal ${tmpDir}: ${err.message}`);
    }
  }
}

main();
