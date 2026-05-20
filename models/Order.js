const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema(
  {
    productId: {
      type: String,
      enum: ["teff_1", "teff_4", "teff_10"],
      required: true
    },
    name: String,
    unitAmount: Number,
    quantity: Number
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    customer: {
      name: String,
      email: String,
      address: String,
      zipCode: String
    },
    items: [orderItemSchema],
    totalAmount: Number,
    currency: {
      type: String,
      default: "usd"
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "expired", "refunded"],
      default: "pending"
    },
    stripeSessionId: String,
    stripePaymentIntentId: String
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", orderSchema);