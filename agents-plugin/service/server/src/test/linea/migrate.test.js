import { test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';
import { migrate, COLLECTIONS } from '../../../scripts/migrate-from-linea.mjs';

let server;
let client;
let source;
let target;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = await MongoClient.connect(server.getUri());
});
afterAll(async () => { await client.close(); await server.stop(); });
beforeEach(async () => {
  await client.db('linea').dropDatabase();
  await client.db('agents').dropDatabase();
  source = client.db('linea');
  target = client.db('agents');
});

const run = (options = {}) => migrate({ fromUrl: server.getUri(), toUrl: server.getUri(), fromDb: 'linea', toDb: 'agents', log: () => {}, ...options });

test('copies what agents owns, remaps the users in it to agents users with the same username, and keeps line and product ids', async () => {
  const ana = new ObjectId();
  const lineId = new ObjectId();
  const productId = new ObjectId();
  await source.collection('users').insertOne({ _id: ana, username: 'ana', avatarUrl: 'a.png', admin: true, accessToken: 'LINEA-TOKEN-MUST-NOT-MOVE' });
  const runId = new ObjectId();
  await source.collection('agentruns').insertOne({
    _id: runId, agentType: 'harvest', createdBy: ana, scope: { lineId, productId },
    proposals: [{ kind: 'fm_patch', decidedBy: ana }],
  });
  await source.collection('agentthreads').insertOne({ _id: new ObjectId(), userId: ana, lineId });

  const result = await run();

  const copied = await target.collection('agentruns').findOne({ _id: runId });
  const user = await target.collection('users').findOne({ username: 'ana' });
  expect(user).toMatchObject({ username: 'ana', avatarUrl: 'a.png', admin: true });
  expect(user.accessToken).toBeUndefined();
  expect(user._id.equals(ana)).toBe(false);
  expect(copied.createdBy.equals(user._id)).toBe(true);
  expect(copied.proposals[0].decidedBy.equals(user._id)).toBe(true);
  expect(copied.scope.lineId.equals(lineId)).toBe(true);
  expect(copied.scope.productId.equals(productId)).toBe(true);
  expect((await target.collection('agentthreads').findOne({})).userId.equals(user._id)).toBe(true);
  expect(result.summary.agentruns).toBe(1);
  expect(result.users).toBe(1);
});

test('does not touch LINEA\'s database', async () => {
  const ana = new ObjectId();
  await source.collection('users').insertOne({ _id: ana, username: 'ana' });
  await source.collection('agentruns').insertOne({ _id: new ObjectId(), createdBy: ana });

  await run();

  expect(await source.collection('agentruns').countDocuments()).toBe(1);
  expect(await source.collection('users').countDocuments()).toBe(1);
});

test('is safe to run again: documents are upserted, users reused', async () => {
  const ana = new ObjectId();
  await source.collection('users').insertOne({ _id: ana, username: 'ana' });
  await source.collection('agentruns').insertOne({ _id: new ObjectId(), createdBy: ana });

  await run();
  await run();

  expect(await target.collection('agentruns').countDocuments()).toBe(1);
  expect(await target.collection('users').countDocuments()).toBe(1);
});

test('reuses an agents user that already has the username (one who logged in to agents before)', async () => {
  const ana = new ObjectId();
  await source.collection('users').insertOne({ _id: ana, username: 'ana' });
  await source.collection('agentruns').insertOne({ _id: new ObjectId(), createdBy: ana });
  const { insertedId } = await target.collection('users').insertOne({ username: 'ana', accessToken: 'agents-token' });

  await run();

  expect((await target.collection('agentruns').findOne({})).createdBy.equals(insertedId)).toBe(true);
  expect(await target.collection('users').countDocuments()).toBe(1);
});

test('--dry-run writes nothing', async () => {
  const ana = new ObjectId();
  await source.collection('users').insertOne({ _id: ana, username: 'ana' });
  await source.collection('agentruns').insertOne({ _id: new ObjectId(), createdBy: ana });

  const result = await run({ dryRun: true });

  expect(result.summary.agentruns).toBe(1);
  expect(await target.collection('agentruns').countDocuments()).toBe(0);
  expect(await target.collection('users').countDocuments()).toBe(0);
});

test('a referenced user LINEA does not know is reported and its reference copied as it is', async () => {
  const ghost = new ObjectId();
  await source.collection('agentruns').insertOne({ _id: new ObjectId(), createdBy: ghost });

  const result = await run();

  expect(result.missing).toEqual([String(ghost)]);
  expect((await target.collection('agentruns').findOne({})).createdBy.equals(ghost)).toBe(true);
});

test('refuses to copy a database onto itself', async () => {
  await expect(migrate({ fromUrl: server.getUri(), toUrl: server.getUri(), fromDb: 'linea', toDb: 'linea', log: () => {} })).rejects.toThrow(/same database/);
});

test('copies exactly the collections agents has models for', () => {
  expect(COLLECTIONS).toHaveLength(11);
});
