const stripe = require("../config/stripe");
const Order = require("../models/Order");

const VALID_PRODUCTS = {
  teff_1: {
    name: "Instant Teff - 1 Pouch",
    unitAmount: 800
  },
  teff_4: {
    name: "The Family - 4 Pouches",
    unitAmount: 2000
  },
  teff_10: {
    name: "The Founder - 10 Pouches",
    unitAmount: 5000
  }
};

async function createPaymentIntent(req, res) {
  try {
    const { customer, items } = req.body;

    if (
      !customer?.name ||
      !customer?.email ||
      !customer?.address ||
      !customer?.zipCode
    ) {
      return res.status(400).json({ message: "Missing customer fields" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Cart is empty" });
    }

    const orderItems = items.map((item) => {
      const product = VALID_PRODUCTS[item.productId];

      if (!product) {
        throw new Error("Invalid product selected");
      }

      const quantity = Number(item.quantity);

      if (!quantity || quantity < 1) {
        throw new Error("Invalid quantity");
      }

      return {
        productId: item.productId,
        name: product.name,
        unitAmount: product.unitAmount,
        quantity
      };
    });

    const totalAmount = orderItems.reduce(
      (sum, item) => sum + item.unitAmount * item.quantity,
      0
    );

    const order = await Order.create({
      customer,
      items: orderItems,
      totalAmount,
      paymentStatus: "pending"
    });

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalAmount,
      currency: "usd",
      receipt_email: customer.email,
      metadata: {
        orderId: order._id.toString()
      }
    });

    order.stripePaymentIntentId = paymentIntent.id;
    await order.save();

    res.json({
      clientSecret: paymentIntent.client_secret,
      orderId: order._id.toString(),
      totalAmount
    });
  } catch (error) {
    res.status(400).json({
      message: "Payment intent failed",
      error: error.message
    });
  }
}

module.exports = { createPaymentIntent };