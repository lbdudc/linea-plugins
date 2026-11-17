import mongoose from 'mongoose';
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Container } from 'typedi';
import { vi } from 'vitest'
import DataSource from '../model/connectors/DataSource.js';

const dataSource = Container.get(DataSource);
let mongoInstance;

export async function setup() {
    mongoInstance = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await dataSource.connect({url: mongoInstance.getUri()}).catch(error => {
        console.error('MongoDB connection error:', error.message);
      });

    await Promise.all(
      Object.values(mongoose.connection.models).map((model) => model.init())
    );
}

export async function teardown() {
    await dataSource.disconnect();
    await mongoInstance.stop();
}

export async function clear() {
    await dataSource.dropDatabase();
    vi.restoreAllMocks();
}