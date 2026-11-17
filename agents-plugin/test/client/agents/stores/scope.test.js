import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouter, createMemoryHistory } from 'vue-router';

// the pages of the agents are under /agents in LINEA, and the scope is theirs alone
const rutas = [
  { path: '/agents', name: 'flujo', component: { template: '<div/>' } },
  { path: '/agents/actividad', name: 'actividad', component: { template: '<div/>' } },
  { path: '/agents/memoria', name: 'memoria', component: { template: '<div/>' } },
  { path: '/lines', name: 'lineas-de-linea', component: { template: '<div/>' } },
];

const tick = () => new Promise((r) => setTimeout(r, 10));

async function cargarScope(rutaInicial = '/') {
  vi.resetModules();
  const router = createRouter({ history: createMemoryHistory(), routes: rutas });
  await router.push(rutaInicial);
  await router.isReady();
  vi.doMock('../../../../client/agents/router/index.js', () => ({ default: router }));
  const { scope } = await import('../../../../client/agents/stores/scope.js');
  return { scope, router };
}

describe('ámbito de agentes', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('elegir una línea la escribe en la query', async () => {
    const { scope, router } = await cargarScope('/agents');
    scope.setScope({ lineId: 'L1' });
    await tick();
    expect(router.currentRoute.value.query.lineId).toBe('L1');
    expect(scope.lineId).toBe('L1');
  });

  it('cambiar de una línea a otra sustituye la anterior', async () => {
    const { scope, router } = await cargarScope('/agents?lineId=L1');
    expect(scope.lineId).toBe('L1');

    scope.setScope({ lineId: 'L2' });
    await tick();

    expect(scope.lineId).toBe('L2');
    expect(router.currentRoute.value.query.lineId).toBe('L2');
  });

  it('vaciar el ámbito quita la línea de la query y no la repone', async () => {
    const { scope, router } = await cargarScope('/agents?lineId=L1');

    scope.setScope({ lineId: null });
    await tick();

    expect(scope.lineId).toBeNull();
    expect(router.currentRoute.value.query.lineId).toBeUndefined();
  });

  it('cambiar de sección conserva la línea aunque el enlace no lleve query', async () => {
    const { scope, router } = await cargarScope('/agents?lineId=L1');

    await router.push('/agents/actividad');
    await tick();

    expect(scope.lineId).toBe('L1');
    expect(router.currentRoute.value.query.lineId).toBe('L1');
  });

  it('tras vaciarlo, cambiar de sección no lo resucita', async () => {
    const { scope, router } = await cargarScope('/agents?lineId=L1');
    scope.setScope({ lineId: null });
    await tick();

    await router.push('/agents/memoria');
    await tick();

    expect(scope.lineId).toBeNull();
    expect(router.currentRoute.value.query.lineId).toBeUndefined();
  });

  it('no se mete en las demás páginas de LINEA: la query de /lines queda como está', async () => {
    const { scope, router } = await cargarScope('/agents?lineId=L1');
    scope.setScope({ lineId: 'L1' });
    await tick();

    await router.push('/lines');
    await tick();

    expect(router.currentRoute.value.fullPath).toBe('/lines');
  });
});
