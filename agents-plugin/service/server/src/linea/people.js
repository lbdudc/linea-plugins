import { Container } from 'typedi';
import UserRepository from '../model/repositories/UserRepository.js';
import User from '../model/entities/user.js';
import { UserNotFoundError } from '../model/errors/errors.js';

/** Agents knows people by the id of its own record; LINEA by their username. */
export const usernameOf = async (userId) => {
  const user = await Container.get(UserRepository).findById(userId);
  if (!user) throw new UserNotFoundError(`No such user: ${userId}`);
  return user.username;
};

/** The agents record of a person LINEA says is signed in: made the first time they use agents. */
export const personFromLinea = async ({ username, admin = false, avatarUrl }) => {
  const user = (await User.findOne({ username })) ?? new User({ username });
  user.admin = Boolean(admin);
  if (avatarUrl) user.avatarUrl = avatarUrl;
  if (user.isNew || user.isModified()) await user.save();
  return user;
};
