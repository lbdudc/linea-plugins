import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import process from "process";
import dotenv from "dotenv";

// Base env file, then local overrides — mirrors how docker-compose merges
// server/.env + server/.env.local for the containerized server (see
// deploy/docker-compose.yml), so `npm run dev` outside Docker behaves the same way.
dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const __dirname = path.resolve();
export let properties;

try {
  properties = yaml.load(
    fs.readFileSync(
      path.join(__dirname, "src/resources/properties.yml"),
      "utf8"
    )
  );
} catch (e) {
  console.error(e);
}

const mongoUrl = process.env.mongoUrl;

export function getMongoUrl() {
  return mongoUrl
    ? mongoUrl
    : `mongodb://${properties.db.hostname}:${properties.db.port}/${properties.db.schema}`;
}

export function getAnthropicApiKey() {
  return process.env.ANTHROPIC_API_KEY;
}

export function getAnthropicModel() {
  return properties.ai?.model ?? 'claude-sonnet-4-6';
}

export function getAnthropicMaxTokens() {
  return properties.ai?.maxTokens ?? 4096;
}

// Base URL of the self-hosted embeddings (TEI) service. Env wins over yml; unset
// disables embeddings (callers fall back to recency-only retrieval).
export function getEmbeddingsUrl() {
  return process.env.EMBEDDINGS_URL ?? properties.ai?.embeddingUrl;
}

export function getEmbeddingsModel() {
  return properties.ai?.embeddingModel ?? 'BAAI/bge-small-en-v1.5';
}

// Optional — only needed if TEI was started with --api-key.
export function getEmbeddingsApiKey() {
  return process.env.EMBEDDINGS_API_KEY;
}
