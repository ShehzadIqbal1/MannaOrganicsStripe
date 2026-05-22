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

function validateCustomer(customer) {
  return (
    customer?.name &&
    customer?.email &&
    customer?.address &&
    customer?.zipCode
  );
}

function buildOrderItems(items) {
  return items.map((item) => {
    const product = VALID_PRODUCTS[item.productId];

    if (!product) {
      throw new Error(`Invalid product selected: ${item.productId}`);
    }

    const quantity = Number(item.quantity);

    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error(`Invalid quantity for product: ${item.productId}`);
    }

    return {
      productId: item.productId,
      name: product.name,
      unitAmount: product.unitAmount,
      quantity
    };
  });
}

async function createPaymentIntent(req, res) {
  try {
    console.log("===== CREATE PAYMENT INTENT START =====");
    console.log("REQ BODY:", JSON.stringify(req.body, null, 2));

    const { customer, items } = req.body;

    if (!validateCustomer(customer)) {
      return res.status(400).json({
        message: "Missing customer fields"
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: "Cart is empty"
      });
    }

    const orderItems = buildOrderItems(items);

    const totalAmount = orderItems.reduce(
      (sum, item) => sum + item.unitAmount * item.quantity,
      0
    );

    if (totalAmount < 50) {
      return res.status(400).json({
        message: "Total amount must be at least $0.50"
      });
    }

    const cleanCustomer = {
      name: customer.name.trim(),
      email: customer.email.trim().toLowerCase(),
      address: customer.address.trim(),
      zipCode: customer.zipCode.trim()
    };

    const order = await Order.create({
      customer: cleanCustomer,
      items: orderItems,
      totalAmount,
      currency: "usd",
      paymentStatus: "pending"
    });

    console.log("ORDER CREATED:", order._id.toString());
    console.log("ORDER ITEMS:", orderItems);
    console.log("TOTAL AMOUNT:", totalAmount);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalAmount,
      currency: "usd",
      receipt_email: cleanCustomer.email,
      automatic_payment_methods: {
        enabled: true
      },
      metadata: {
        orderId: order._id.toString(),
        customerEmail: cleanCustomer.email
      }
    });

    console.log("PAYMENT INTENT CREATED:", {
      id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      metadata: paymentIntent.metadata,
      clientSecretExists: Boolean(paymentIntent.client_secret)
    });

    order.stripePaymentIntentId = paymentIntent.id;
    await order.save();

    console.log("ORDER UPDATED WITH PAYMENT INTENT:", order._id.toString());
    console.log("===== CREATE PAYMENT INTENT END =====");

    return res.status(201).json({
      clientSecret: paymentIntent.client_secret,
      orderId: order._id.toString(),
      paymentIntentId: paymentIntent.id,
      totalAmount,
      currency: "usd"
    });
  } catch (error) {
    console.error("CREATE PAYMENT INTENT ERROR:", error.message);

    return res.status(400).json({
      message: "Payment intent failed",
      error: error.message
    });
  }
}

module.exports = { createPaymentIntent };