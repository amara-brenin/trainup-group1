const mongoose = require("mongoose");
const config = require("../config");

let connectionPromise = null;

const connectDatabase = async () => {
  if (!config.mongoUri) {
    throw new Error("MONGO_URI is not configured.");
  }

  if (!connectionPromise) {
    mongoose.set("strictQuery", true);
    connectionPromise = mongoose.connect(config.mongoUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
    });
  }

  await connectionPromise;
  return mongoose.connection;
};

module.exports = {
  mongoose,
  connectDatabase,
};
