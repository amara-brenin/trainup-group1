require("dotenv").config();
const { connectDatabase } = require("../src/database/connect");
const Plan = require("../src/models/Plan");

async function run() {
  await connectDatabase();
  const plans = await Plan.find({}).lean();
  console.log("ALL PLANS IN DB:", JSON.stringify(plans, null, 2));
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
