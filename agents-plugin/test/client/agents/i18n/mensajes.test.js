import { describe, expect, it } from 'vitest';
import { baseCompile } from '@intlify/message-compiler';

import es from '../../../../client/agents/i18n/es/index.js';
import en from '../../../../client/agents/i18n/en/index.js';
import gl from '../../../../client/agents/i18n/gl/index.js';

const LOCALES = { es, en, gl };

function cadenas(objeto, prefijo = '') {
  return Object.entries(objeto).flatMap(([clave, valor]) => {
    const ruta = prefijo ? `${prefijo}.${clave}` : clave;
    if (typeof valor === 'string') return [[ruta, valor]];
    if (valor && typeof valor === 'object') return cadenas(valor, ruta);
    return [];
  });
}

describe('mensajes de i18n', () => {
  for (const [locale, mensajes] of Object.entries(LOCALES)) {
    it(`${locale}: todos compilan`, () => {
      const fallos = [];
      for (const [ruta, texto] of cadenas(mensajes)) {
        try {
          const errores = [];
          baseCompile(texto, { onError: (e) => errores.push(e.message) });
          if (errores.length) fallos.push(`${ruta}: ${JSON.stringify(texto)} -> ${errores.join('; ')}`);
        } catch (e) {
          fallos.push(`${ruta}: ${JSON.stringify(texto)} -> ${e.message}`);
        }
      }
      expect(fallos).toEqual([]);
    });
  }

  it('los tres idiomas tienen las mismas claves', () => {
    const claves = Object.fromEntries(
      Object.entries(LOCALES).map(([l, m]) => [l, cadenas(m).map(([r]) => r).sort()]),
    );
    expect(claves.en).toEqual(claves.es);
    expect(claves.gl).toEqual(claves.es);
  });
});
