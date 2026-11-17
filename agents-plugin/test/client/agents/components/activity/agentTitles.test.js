import { describe, expect, it } from 'vitest';

import { agentTitle } from '../../../../../client/agents/components/activity/agentTitles.js';

const TIPOS_DE_AGENTE = [
  'harvest',
  'sync',
  'line-sync',
  'regen',
  'variant-miner',
  'line-health',
  'changeset',
  'evolution',
  'feature-location',
  'fm-constraint-advisor',
];

describe('agentTitle', () => {
  it.each(TIPOS_DE_AGENTE)('resuelve un título real (no la clave i18n en crudo) para "%s"', (tipo) => {
    const titulo = agentTitle(tipo);
    expect(titulo).toBeTruthy();
    expect(titulo.startsWith('labels.')).toBe(false);
    expect(titulo).not.toBe(tipo);
  });

  it('un tipo de agente desconocido no revienta la pantalla: cae al propio nombre en crudo', () => {
    expect(agentTitle('un-agente-que-no-existe')).toBe('un-agente-que-no-existe');
  });

  it('sin agentType (undefined) no revienta', () => {
    expect(agentTitle(undefined)).toBe('—');
  });
});
