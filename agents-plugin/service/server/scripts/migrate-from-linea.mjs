#!/usr/bin/env node
/**
 * Moves what agents owns out of the database it used to share with LINEA, into its own.
 *
 *   node scripts/migrate-from-linea.mjs --from <linea mongo url> --to <agents mongo url> [--dry-run]
 *
 * Copies the collections only agents wrote (runs, memory, configuration, change set versions, ...) and leaves LINEA's alone. Lines and
 * products keep their ids (they still point at LINEA's). People do not: agents has its own users, so each LINEA user referenced by a
 * copied document becomes an agents user with the same username (no tokens: they get them the first time they log in to agents), and the
 * references are changed to it. Safe to run again: documents are upserted by id.
 *
 * Afterwards, when agents runs well on its own, drop the copied collections from LINEA's database (the script says which).
 */
import { MongoClient } from 'mongodb';

export const COLLECTIONS = [
  'agentruns', 'agentconfigs', 'agentpolicies', 'agentmemories', 'agentthreads', 'agentmessages',
  'changesetversions', 'versionchatmessages', 'harvestdispositions', 'testresults', 'webhookdeliveries',
];

// the fields that hold a user id, wherever they are in a document
const USER_FIELDS = new Set(['createdBy', 'decidedBy', 'userId']);

const idKey = (value) => String(value);

const collectUserIds = (value, found = new Set()) => {
  if (Array.isArray(value)) value.forEach((item) => collectUserIds(item, found));
  else if (value && typeof value === 'object' && !value._bsontype) {
    for (const [key, inner] of Object.entries(value)) {
      if (USER_FIELDS.has(key) && inner && inner._bsontype === 'ObjectId') found.add(idKey(inner));
      else collectUserIds(inner, found);
    }
  }
  return found;
};

const remap = (value, map) => {
  if (Array.isArray(value)) return value.map((item) => remap(item, map));
  if (value && typeof value === 'object' && !value._bsontype) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [
      key,
      USER_FIELDS.has(key) && inner && inner._bsontype === 'ObjectId' && map.has(idKey(inner)) ? map.get(idKey(inner)) : remap(inner, map),
    ]));
  }
  return value;
};

export const migrate = async ({ fromUrl, toUrl, fromDb, toDb, dryRun = false, log = console.log }) => {
  const from = await MongoClient.connect(fromUrl);
  const to = fromUrl === toUrl ? from : await MongoClient.connect(toUrl);
  try {
    const source = from.db(fromDb);
    const target = to.db(toDb);
    if (fromUrl === toUrl && fromDb === toDb) throw new Error('--from and --to are the same database');

    const documents = {};
    for (const name of COLLECTIONS) documents[name] = await source.collection(name).find({}).toArray();

    // LINEA users referenced anywhere → agents users with the same username
    const referenced = new Set();
    for (const docs of Object.values(documents)) docs.forEach((doc) => collectUserIds(doc, referenced));
    const lineaUsers = await source.collection('users').find({}).toArray();
    const byId = new Map(lineaUsers.map((user) => [idKey(user._id), user]));
    const map = new Map();
    const missing = [];
    for (const id of referenced) {
      const user = byId.get(id);
      if (!user) { missing.push(id); continue; }
      const existing = await target.collection('users').findOne({ username: user.username });
      if (existing) { map.set(id, existing._id); continue; }
      if (dryRun) { map.set(id, user._id); continue; }
      const { insertedId } = await target.collection('users').insertOne({ username: user.username, avatarUrl: user.avatarUrl, admin: Boolean(user.admin), createdAt: new Date(), activeSessions: [] });
      map.set(id, insertedId);
    }
    if (missing.length) log(`warning: ${missing.length} referenced user id(s) are not in LINEA's users; their references are copied as they are`);

    const summary = {};
    for (const [name, docs] of Object.entries(documents)) {
      summary[name] = docs.length;
      if (dryRun || docs.length === 0) continue;
      await target.collection(name).bulkWrite(docs.map((doc) => ({ replaceOne: { filter: { _id: doc._id }, replacement: remap(doc, map), upsert: true } })));
    }
    log(`${dryRun ? 'would copy' : 'copied'}: ${JSON.stringify(summary)}; users mapped: ${map.size}`);
    if (!dryRun) log(`when agents runs well on its own, drop these from LINEA's database: ${COLLECTIONS.join(', ')}`);
    return { summary, users: map.size, missing };
  } finally {
    await from.close();
    if (to !== from) await to.close();
  }
};

const argsOf = (argv) => {
  const out = { dryRun: argv.includes('--dry-run') };
  for (const flag of ['from', 'to']) {
    const i = argv.indexOf(`--${flag}`);
    if (i >= 0) out[flag] = argv[i + 1];
  }
  return out;
};

const dbNameOf = (url) => new URL(url).pathname.replace(/^\//, '') || 'test';

if (import.meta.url === `file://${process.argv[1]}`) {
  const { from, to, dryRun } = argsOf(process.argv.slice(2));
  if (!from || !to) {
    console.error('usage: node scripts/migrate-from-linea.mjs --from <linea mongo url> --to <agents mongo url> [--dry-run]');
    process.exit(2);
  }
  migrate({ fromUrl: from, toUrl: to, fromDb: dbNameOf(from), toDb: dbNameOf(to), dryRun })
    .catch((error) => { console.error(error.message); process.exit(1); });
}
