import { MongoClient } from "mongodb";

const globalForMongo = globalThis;

let mongoClient = globalForMongo.__trainupMongoClient || null;
let mongoPromise = globalForMongo.__trainupMongoPromise || null;

const getMongoUri = () => {
  const mongoUri = String(process.env.MONGO_URI || "").trim();

  if (!mongoUri) {
    throw new Error("MONGO_URI is not configured.");
  }

  return mongoUri;
};

export const getDb = async () => {
  if (!mongoClient) {
    mongoClient = new MongoClient(getMongoUri(), {
      maxPoolSize: 10,
    });
    mongoPromise = mongoClient.connect();
    globalForMongo.__trainupMongoClient = mongoClient;
    globalForMongo.__trainupMongoPromise = mongoPromise;
  }

  const connectedClient = await mongoPromise;
  return connectedClient.db();
};

export const getCollections = async () => {
  const db = await getDb();

  return {
    db,
    users: db.collection("users"),
    clients: db.collection("clients"),
    apiKeys: db.collection("apiKeys"),
    configs: db.collection("configs"),
    trainings: db.collection("trainings"),
    mediaAssets: db.collection("mediaAssets"),
  };
};
