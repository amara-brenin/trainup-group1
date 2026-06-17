// One-time migration: moves base64 image data already stored in MongoDB
// (User.image, SuperAdmin.image, Client.logoUrl/darkLogoUrl/faviconUrl/
// emailSignatureImageUrl) to S3, replacing the field with the resulting
// public URL. Safe to re-run — resolveImageField() is a no-op for any value
// that is already an http(s) URL, so already-migrated records are skipped.
//
// Usage: node scripts/migrate-images-to-s3.js
require("dotenv").config();

const { connectDatabase, mongoose } = require("../src/database/connect");
const { isBase64Image, uploadBase64Image } = require("../src/helpers/imageStorage");
const { isStorageConfigured } = require("../src/helpers/storage");
const { buildDefaultTenantAppSettings, setTenantSetting } = require("../src/helpers/tenant");
const User = require("../src/models/User");
const SuperAdmin = require("../src/models/SuperAdmin");
const Client = require("../src/models/Client");

const migrateField = async ({ Model, label, field, category }) => {
  const filter = { [field]: { $regex: "^data:image/", $options: "i" } };
  const docs = await Model.find(filter, { [field]: 1 }).lean();

  let migrated = 0;
  let failed = 0;

  for (const doc of docs) {
    const value = doc[field];
    if (!isBase64Image(value)) {
      continue;
    }

    try {
      const url = await uploadBase64Image({ base64: value, category });
      if (!url) {
        failed += 1;
        continue;
      }

      await Model.updateOne({ _id: doc._id }, { $set: { [field]: url } });
      migrated += 1;
    } catch (error) {
      failed += 1;
      console.error(`  Failed to migrate ${label}.${field} for ${doc._id}:`, error.message);
    }
  }

  console.log(`${label}.${field}: scanned ${docs.length}, migrated ${migrated}, failed ${failed}`);
  return { scanned: docs.length, migrated, failed };
};

(async () => {
  if (!isStorageConfigured) {
    console.error("AWS S3 is not configured (check AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_S3_BUCKET/AWS_S3_REGION). Aborting.");
    process.exit(1);
  }

  await connectDatabase();
  console.log("Connected to database. Scanning for base64 images...\n");

  const results = [
    await migrateField({ Model: User, label: "User", field: "image", category: "avatars" }),
    await migrateField({ Model: SuperAdmin, label: "SuperAdmin", field: "image", category: "super-admin-avatars" }),
    await migrateField({ Model: Client, label: "Client", field: "logoUrl", category: "client-logos" }),
    await migrateField({ Model: Client, label: "Client", field: "darkLogoUrl", category: "client-dark-logos" }),
    await migrateField({ Model: Client, label: "Client", field: "faviconUrl", category: "client-favicons" }),
    await migrateField({ Model: Client, label: "Client", field: "emailSignatureImageUrl", category: "client-email-signatures" }),
  ];

  // GET /settings is served from a cached "appSettings" snapshot
  // (Setting collection, key client:<id>:appSettings) that was written the
  // last time branding was saved — refresh it for every client so the
  // newly-migrated logoUrl/darkLogoUrl/faviconUrl URLs actually take effect
  // instead of being shadowed by a stale cached base64 copy.
  const clients = await Client.find({}, { appId: 1, name: 1, logoUrl: 1, darkLogoUrl: 1, faviconUrl: 1 }).lean();
  for (const client of clients) {
    await setTenantSetting(client.appId, "appSettings", buildDefaultTenantAppSettings(client));
  }
  console.log(`Refreshed cached appSettings snapshot for ${clients.length} client(s).`);

  const totals = results.reduce(
    (acc, r) => ({
      scanned: acc.scanned + r.scanned,
      migrated: acc.migrated + r.migrated,
      failed: acc.failed + r.failed,
    }),
    { scanned: 0, migrated: 0, failed: 0 },
  );

  console.log(`\nDone. Total scanned: ${totals.scanned}, migrated: ${totals.migrated}, failed: ${totals.failed}`);
  await mongoose.disconnect();
  process.exit(totals.failed > 0 ? 1 : 0);
})().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
