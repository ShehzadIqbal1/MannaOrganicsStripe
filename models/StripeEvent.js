const mongoose = require("mongoose");

const stripeEventSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    type: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ["processing", "processed", "failed"],
      default: "processing"
    },
    errorMessage: String,
    processedAt: Date
  },
  { timestamps: true }
);

module.exports = mongoose.model("StripeEvent", stripeEventSchema);