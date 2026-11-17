import mongoose from 'mongoose';
import { Container } from 'typedi';
import { getMongoUrl } from '../../model/connectors/properties.js';
import AgentMemoryRepository from '../models/AgentMemoryRepository.js';
import EmbeddingService from './EmbeddingService.js';

/**
 * One-time backfill: embed existing AgentMemory documents that have no vector.
 * Idempotent — re-runnable; only touches memories missing `embedding`.
 *
 * Usage (from server/):  node src/agents/memory/backfillEmbeddings.js
 */
const BATCH = 64;

const run = async () => {
  const embeddings = Container.get(EmbeddingService);
  if (!embeddings.enabled) {
    console.error('EMBEDDINGS_URL is not set — nothing to backfill.');
    process.exit(1);
  }

  await mongoose.connect(getMongoUrl());
  const repo = Container.get(AgentMemoryRepository);

  let total = 0;
  // findMissingEmbedding caps at `limit`; loop until the pool drains.
  for (;;) {
    const batch = await repo.findMissingEmbedding({ limit: BATCH });
    if (!batch.length) break;

    const vectors = await embeddings.embedBatch(batch.map((m) => m.content), 'document');
    if (!vectors) {
      console.error('Embedding request failed — stopping. Re-run to resume.');
      break;
    }
    // Independent docs within the batch — write them in parallel instead of
    // one Mongo round trip at a time.
    await Promise.all(batch.map((m, i) =>
      repo.setEmbedding(m._id, { embedding: vectors[i], embeddingModel: embeddings.model })
    ));
    total += batch.length;
    console.log(`embedded ${total} memories…`);
  }

  console.log(`done — ${total} memories embedded.`);
  await mongoose.disconnect();
  process.exit(0);
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
