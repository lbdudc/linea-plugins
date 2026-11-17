import { socket as lineaSocket, wsConnected } from 'src/boot/ws';

/**
 * What the agents' pages hear. The agents' service tells LINEA, and LINEA puts it on the socket the browser already has open, as
 * `agents:<event>`; these pages ask for the plain names (`agent-run`, `version-updated`...) as they always did.
 */
const wrapped = {
  on: (event, handler) => lineaSocket?.on(`agents:${event}`, handler),
  off: (event, handler) => lineaSocket?.off(`agents:${event}`, handler),
  emit: () => {},
};

export { wrapped as socket, wsConnected };
export const connect = () => wrapped;
export const disconnect = () => {};
