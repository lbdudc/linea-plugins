import { Container } from 'typedi';
import { getEmbeddingsUrl, getEmbeddingsModel, getEmbeddingsApiKey } from '../../model/connectors/properties.js';

/**
 * Thin client for a self-hosted HuggingFace Text Embeddings Inference (TEI)
 * service — a free, open-source embeddings server (run as the `embeddings`
 * container in deploy/docker-compose.yml). Anthropic's SDK has no embeddings
 * endpoint, so embeddings are produced out-of-process here.
 *
 * Powers semantic recall of agent memories. Every method is best-effort: with no
 * EMBEDDINGS_URL or on any error it returns null so callers fall back to
 * recency-only retrieval. Embeddings must never break a run.
 */
export default class EmbeddingService {
  // True only when an embeddings service URL is configured — lets callers skip
  // embedding work entirely when none is available.
  get enabled() {
    return Boolean(getEmbeddingsUrl());
  }

  // Bookkeeping tag stored alongside each vector (model id, e.g. bge-small).
  get model() {
    return getEmbeddingsModel();
  }

  // Embed a single string. Returns number[] or null.
  embed = async (text, inputType = 'document') => {
    const [vector] = (await this.embedBatch([text], inputType)) ?? [];
    return vector ?? null;
  };

  // Embed many strings in one call. Returns number[][] aligned to `texts`, or null.
  // `inputType` is accepted for caller compatibility but unused — TEI has no
  // query/document distinction.
  embedBatch = async (texts) => {
    const baseUrl = getEmbeddingsUrl();
    if (!baseUrl || !texts?.length) return null;
    const apiKey = getEmbeddingsApiKey();
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/embed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        // `truncate` keeps over-long inputs from erroring the whole batch.
        body: JSON.stringify({ inputs: texts, truncate: true }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => res.statusText);
        console.warn(`[agents] TEI embeddings ${res.status}: ${detail}`);
        return null;
      }
      // TEI returns the vectors directly as an array aligned to `inputs`.
      const vectors = await res.json();
      if (!Array.isArray(vectors) || vectors.length !== texts.length) return null;
      return vectors.every((v) => Array.isArray(v) && v.length) ? vectors : null;
    } catch (err) {
      console.warn('[agents] TEI embeddings request failed:', err?.message ?? err);
      return null;
    }
  };
}

// Cosine similarity between two equal-length vectors. Returns -1..1 (0 if either
// is missing or zero-length).
export const cosineSimilarity = (a, b) => {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

Container.set(EmbeddingService, new EmbeddingService());
