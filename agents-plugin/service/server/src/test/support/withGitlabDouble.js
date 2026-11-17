import { startGitlabDouble } from './gitlabDouble.js';

let double = null;
let previousHostname;

export async function setupGitlabDouble() {
  double = await startGitlabDouble();
  previousHostname = process.env.GITLAB_HOSTNAME;
  process.env.GITLAB_HOSTNAME = double.url;
}

export function resetGitlabDouble() {
  double?.reset();
}

export async function teardownGitlabDouble() {
  await double?.close();
  double = null;
  if (previousHostname === undefined) delete process.env.GITLAB_HOSTNAME;
  else process.env.GITLAB_HOSTNAME = previousHostname;
}

export function gitlabDouble() {
  if (!double) throw new Error('gitlabDouble() called before setupGitlabDouble() — check hook order.');
  return double;
}
