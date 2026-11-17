import { timingSafeEqual } from 'node:crypto';
import { IncorrectCredentialsError, PermissionError } from '../../model/errors/errors.js';
import { onError } from './onError.js';
import { runAs } from '../../linea/actingUser.js';
import { personFromLinea } from '../../linea/people.js';

/**
 * Agents has no login of its own. It is a service of LINEA (a plugin's): people sign in to LINEA, and LINEA's server passes their calls
 * on with the key it shares with agents (`X-Agents-Key`, the AGENTS_SERVICE_KEY of both) and who they are (`X-Act-As`, `X-Act-As-Admin`).
 * Nothing else reaches the API: the key is the deployment's, and agents is not published anywhere a browser can reach.
 */
const keyIsRight = (given) => {
  const wanted = Buffer.from(process.env.AGENTS_SERVICE_KEY ?? '');
  const got = Buffer.from(String(given ?? ''));
  return wanted.length > 0 && wanted.length === got.length && timingSafeEqual(wanted, got);
};

const authenticate = async (req) => {
  if (!keyIsRight(req.headers['x-agents-key'])) throw new IncorrectCredentialsError();
  const username = req.headers['x-act-as'];
  if (!username) throw new IncorrectCredentialsError();
  return personFromLinea({
    username: String(username),
    admin: req.headers['x-act-as-admin'] === '1',
    avatarUrl: req.headers['x-act-as-avatar'] ? String(req.headers['x-act-as-avatar']) : undefined,
  });
};

export const requireAuth = async (req, res, next) => {
  try {
    const user = await authenticate(req);
    req.userId = String(user._id);
    runAs(req.userId, () => next());
  } catch (error) {
    onError(error, req, res);
  }
};

export const requireAdmin = async (req, res, next) => {
  try {
    const user = await authenticate(req);
    if (!user.admin) throw new PermissionError();
    req.userId = String(user._id);
    runAs(req.userId, () => next());
  } catch (error) {
    onError(error, req, res);
  }
};
