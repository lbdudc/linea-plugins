import { lineaRequest } from './LineaClient.js';

/**
 * What agents has instead of a socket server: the events for a person (a run moved, a step was added...) go to LINEA, and LINEA puts
 * them on that person's socket, the one their browser has open (see agents-plugin's `/relay`). It has the `io.to(room).emit(event, payload)`
 * shape the rest of agents already emits through; the room is a person (the id of their agents record).
 */
export const lineaIo = {
  to: (userId) => ({
    emit: (event, payload) => {
      lineaRequest({ userId, method: 'POST', path: '/api/plugins/agents-plugin/relay', body: { event, payload }, timeoutMs: 5000 })
        .catch((error) => console.warn(`[agents] could not pass "${event}" on to LINEA:`, error?.message ?? error));
    },
  }),
};
