import { Container } from 'typedi';
import UserRepository from '../../model/repositories/UserRepository.js';

/**
 * Who the background work (pushes, the scheduler, domain events, the reconcile sweep) acts as. Agents acts on LINEA as a person who has
 * signed in to it, so these resolve a git username to that person; the ones nobody asked for are the bot.
 */

/** The agents user with that git username, if they have logged in to agents. */
export const userIdByUsername = async (username) => {
  if (!username) return null;
  const user = await Container.get(UserRepository).findByUsername(username);
  return user ? String(user._id) : null;
};

/** The service account (`BOT_USER`: a git username that has logged in to agents), or `null` when none is set or it has not logged in. */
export const botUserId = async () => {
  const username = process.env.BOT_USER;
  if (!username) return null;
  const id = await userIdByUsername(username);
  if (!id) console.warn(`[agents] BOT_USER "${username}" has not logged in to agents: there is nobody to act as`);
  return id;
};
