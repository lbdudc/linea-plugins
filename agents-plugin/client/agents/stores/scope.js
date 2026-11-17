import { reactive } from 'vue';

import router from '../router/index.js';

function leerAmbitoDeLaQuery(query) {
  return {
    lineId: typeof query.lineId === 'string' && query.lineId !== '' ? query.lineId : null,
    productId: typeof query.productId === 'string' && query.productId !== '' ? query.productId : null,
  };
}

const _state = reactive(leerAmbitoDeLaQuery(router.currentRoute.value.query));

// El ámbito se recuerda en memoria, no solo en la query. Los enlaces de la
// barra lateral son rutas fijas y sin query, así que cambiar de sección lo
// perdería; se repone aquí, después de navegar, y no enlace a enlace, para que
// uno nuevo no vuelva a olvidarlo.
//
// Se repone DESPUÉS y no redirigiendo antes: un `beforeEach` que devuelve otro
// destino aborta la navegación en curso y deja el router en un estado donde el
// siguiente `replace` del propio selector ya no surte efecto.
router.afterEach((to) => {
  // the scope is the agents' pages': it is not put on the rest of LINEA
  if (!to.path.startsWith('/agents')) return;
  const enLaQuery = leerAmbitoDeLaQuery(to.query);

  const faltaAlguno = (enLaQuery.lineId === null && _state.lineId !== null)
    || (enLaQuery.productId === null && _state.productId !== null);

  if (faltaAlguno) {
    const query = { ...to.query };
    if (_state.lineId) query.lineId = _state.lineId;
    if (_state.productId) query.productId = _state.productId;
    router.replace({ path: to.path, query, hash: to.hash });
    return;
  }

  if (_state.lineId !== enLaQuery.lineId) _state.lineId = enLaQuery.lineId;
  if (_state.productId !== enLaQuery.productId) _state.productId = enLaQuery.productId;
});

function establecerAmbito({ lineId = null, productId = null } = {}) {
  _state.lineId = lineId;
  _state.productId = productId;

  const query = { ...router.currentRoute.value.query };
  if (lineId) query.lineId = lineId;
  else delete query.lineId;
  if (productId) query.productId = productId;
  else delete query.productId;

  router.replace({ query });
}

export const scope = {
  get lineId() {
    return _state.lineId;
  },
  get productId() {
    return _state.productId;
  },
  setScope: establecerAmbito,
};
