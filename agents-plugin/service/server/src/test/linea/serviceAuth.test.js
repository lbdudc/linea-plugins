import express from 'express';
import request from 'supertest';
import { test, expect, describe, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import User from '../../model/entities/user.js';
import { setup, clear, teardown } from '../setup.js';
import { requireAuth, requireAdmin } from '../../rest/common/auth.js';
import { onError } from '../../rest/common/onError.js';
import { actingUserId } from '../../linea/actingUser.js';

beforeAll(setup);
beforeEach(() => { process.env.AGENTS_SERVICE_KEY = 'k-1'; });
afterEach(async () => { await clear(); delete process.env.AGENTS_SERVICE_KEY; });
afterAll(teardown);

const app = express();
app.get('/who', requireAuth, (req, res) => res.json({ userId: req.userId, acting: actingUserId() }));
app.get('/admin', requireAdmin, (req, res) => res.json({ userId: req.userId }));
app.use(onError);

const from = (headers) => request(app).get('/who').set(headers);

describe('agents has no login: LINEA\'s server passes people on with the key it shares', () => {
  test('a person LINEA says is signed in is made the first time, and is who the call runs as', async () => {
    const res = await from({ 'X-Agents-Key': 'k-1', 'X-Act-As': 'ana', 'X-Act-As-Avatar': 'http://a/x.png' });

    expect(res.status).toBe(200);
    const user = await User.findOne({ username: 'ana' });
    expect(res.body).toEqual({ userId: String(user._id), acting: String(user._id) });
    expect(user.avatarUrl).toBe('http://a/x.png');
    expect(user.admin).toBe(false);
  });

  test('is the same person the next time, and what LINEA says of them (admin) is kept up to date', async () => {
    await from({ 'X-Agents-Key': 'k-1', 'X-Act-As': 'ana' });
    await from({ 'X-Agents-Key': 'k-1', 'X-Act-As': 'ana', 'X-Act-As-Admin': '1' });

    expect(await User.countDocuments({ username: 'ana' })).toBe(1);
    expect((await User.findOne({ username: 'ana' })).admin).toBe(true);
  });

  test('a wrong key, no key, or nobody to act as is a 401', async () => {
    expect((await from({ 'X-Agents-Key': 'nope', 'X-Act-As': 'ana' })).status).toBe(401);
    expect((await from({ 'X-Act-As': 'ana' })).status).toBe(401);
    expect((await from({ 'X-Agents-Key': 'k-1' })).status).toBe(401);
    expect(await User.countDocuments()).toBe(0);
  });

  test('with no key configured nothing gets in', async () => {
    delete process.env.AGENTS_SERVICE_KEY;
    expect((await from({ 'X-Agents-Key': '', 'X-Act-As': 'ana' })).status).toBe(401);
  });

  test('an old bearer session is not a way in any more', async () => {
    expect((await from({ Authorization: 'Bearer eyJ.fake.token' })).status).toBe(401);
  });

  test('requireAdmin lets in only a person LINEA says is an admin', async () => {
    const as = (extra) => request(app).get('/admin').set({ 'X-Agents-Key': 'k-1', 'X-Act-As': 'ana', ...extra });

    expect((await as({})).status).toBe(403);
    expect((await as({ 'X-Act-As-Admin': '1' })).status).toBe(200);
  });
});
