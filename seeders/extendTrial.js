
import "dotenv/config";
import mongoose from "mongoose";

async function extendTrial() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const businessId = new mongoose.Types.ObjectId(
      "6aeb2c64a44da055d3e3f41c"
    );

    const result = await mongoose.connection.db
      .collection("subscriptions")
      .updateOne(
        {
          businessId,
          plan: "trial"
        },
        {
          $set: {
            status: "trialing",
            trialDays: 3,
            trialExtensionDays: 17,
            endDate: new Date("2026-11-24T13:00:26.236Z"),
            updatedAt: new Date()
          }
        }
      );

    console.log("Matched:", result.matchedCount);
    console.log("Modified:", result.modifiedCount);

    if (result.matchedCount === 0) {
      console.log("Subscription not found.");
    } else {
      console.log("Trial updated successfully!");
    }
  } catch (error) {
    console.error("Error:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

extendTrial();
