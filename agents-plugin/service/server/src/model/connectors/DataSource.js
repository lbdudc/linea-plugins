import mongoose from "mongoose";
import { getMongoUrl } from "./properties.js";
import { Container } from "typedi";

export default class DataSource {
  connect = async ({ url }) =>
    await mongoose.connect(`${url ? url : getMongoUrl()}`);

  disconnect = async () => await mongoose.disconnect();

  dropDatabase = async () => await mongoose.connection.dropDatabase();

  startTransaction = async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    return session;
  };

  commitTransaction = async (session) => {
    await session.commitTransaction();
    session.endSession();
  };

  abortTransaction = async (session) => {
    await session.abortTransaction();
    session.endSession();
  };
}

Container.set(DataSource, new DataSource());
