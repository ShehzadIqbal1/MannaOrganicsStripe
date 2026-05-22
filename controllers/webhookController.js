const stripe = require("../config/stripe");
const Order = require("../models/Order");
const StripeEvent = require("../models/StripeEvent");
const mailer = require("../config/mailer");

function orderEmailTemplate(order) {
  const itemsHtml = order.items
    .map(
      (item) => `
        <tr>
          <td>${item.name}</td>
          <td>${item.quantity}</td>
          <td>$${(item.unitAmount / 100).toFixed(2)}</td>
        </tr>
      `
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#222;">
      <h2>Thank you for your order!</h2>
      <p>Hi ${order.customer.name},</p>
      <p>Your Manna Organics order has been received successfully.</p>

      <h3>Order Details</h3>
      <table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse;">
        <thead>
          <tr>
            <th>Product</th>
            <th>Qty</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <p><strong>Total:</strong> $${(order.totalAmount / 100).toFixed(2)}</p>

      <h3>Shipping Address</h3>
      <p>
        ${order.customer.address}<br/>
        ZIP Code: ${order.customer.zipCode}
      </p>

      <p>We will contact you soon with shipping updates.</p>
      <p>— Manna Organics</p>
    </div>
  `;
}

function ownerOrderEmailTemplate(order) {
  const itemsHtml = order.items
    .map(
      (item) => `
        <tr>
          <td>${item.name}</td>
          <td>${item.quantity}</td>
          <td>$${(item.unitAmount / 100).toFixed(2)}</td>
        </tr>
      `
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#222;">
      <h2>New Order Received</h2>

      <p><strong>Order ID:</strong> ${order._id}</p>
      <p><strong>Payment Status:</strong> ${order.paymentStatus}</p>
      <p><strong>Total:</strong> $${(order.totalAmount / 100).toFixed(2)}</p>

      <h3>Customer Details</h3>
      <p>
        <strong>Name:</strong> ${order.customer.name}<br/>
        <strong>Email:</strong> ${order.customer.email}<br/>
        <strong>Address:</strong> ${order.customer.address}<br/>
        <strong>ZIP Code:</strong> ${order.customer.zipCode}
      </p>

      <h3>Items</h3>
      <table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse;">
        <thead>
          <tr>
            <th>Product</th>
            <th>Qty</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
    </div>
  `;
}

async function sendOrderEmailSafe(order) {
  try {
    const customerEmail = await mailer.sendMail({
      to: order.customer.email,
      subject: "Your Manna Organics Order Confirmation",
      html: orderEmailTemplate(order)
    });

    console.log("CUSTOMER EMAIL SENT:", customerEmail);

    if (process.env.OWNER_EMAIL) {
      const ownerEmail = await mailer.sendMail({
        to: process.env.OWNER_EMAIL,
        subject: `New Order Received - ${order._id}`,
        html: ownerOrderEmailTemplate(order)
      });

      console.log("OWNER EMAIL SENT:", ownerEmail);
    }

    return true;
  } catch (error) {
    console.error("Order email failed:", error.message);
    return false;
  }
}

async function markPaymentIntentOrderPaid(paymentIntent) {
  const orderId = paymentIntent.metadata?.orderId;

  console.log("PAYMENT INTENT SUCCEEDED:", paymentIntent.id);
  console.log("ORDER ID FROM METADATA:", orderId);

  if (!orderId) {
    throw new Error("Missing orderId in payment_intent metadata");
  }

  const order = await Order.findById(orderId);

  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }

  console.log("ORDER FOUND:", order._id.toString());
  console.log("CURRENT PAYMENT STATUS:", order.paymentStatus);

  if (order.paymentStatus === "paid") {
    console.log("ORDER ALREADY PAID, SKIPPING:", order._id.toString());
    return order;
  }

  order.paymentStatus = "paid";
  order.stripePaymentIntentId = paymentIntent.id;

  await order.save();

  console.log("ORDER MARKED PAID:", order._id.toString());

  await sendOrderEmailSafe(order);

  console.log("EMAIL FUNCTION COMPLETED FOR:", order.customer.email);

  return order;
}

async function markPaymentIntentOrderFailed(paymentIntent) {
  const orderId = paymentIntent.metadata?.orderId;

  console.log("PAYMENT INTENT FAILED:", paymentIntent.id);
  console.log("FAILED ORDER ID:", orderId);

  if (!orderId) {
    console.log("No orderId metadata found for failed payment.");
    return null;
  }

  const order = await Order.findById(orderId);

  if (!order) {
    console.log("Failed payment order not found:", orderId);
    return null;
  }

  if (order.paymentStatus !== "paid") {
    order.paymentStatus = "failed";
    order.stripePaymentIntentId = paymentIntent.id;
    await order.save();

    console.log("ORDER MARKED FAILED:", orderId);
  }

  return order;
}

async function markOrderRefundedFromCharge(charge) {
  const paymentIntentId = charge.payment_intent;

  console.log("CHARGE REFUNDED:", charge.id);
  console.log("PAYMENT INTENT ID FROM CHARGE:", paymentIntentId);

  if (!paymentIntentId) {
    console.log("No payment intent found on refunded charge.");
    return null;
  }

  const order = await Order.findOneAndUpdate(
    { stripePaymentIntentId: paymentIntentId },
    { paymentStatus: "refunded" },
    { new: true }
  );

  if (order) {
    console.log("ORDER MARKED REFUNDED:", order._id.toString());
  } else {
    console.log("No order found for refunded payment intent:", paymentIntentId);
  }

  return order;
}

async function handleStripeWebhook(req, res) {
  const signature = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error("Stripe webhook signature error:", error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  let stripeEvent;

  try {
    try {
      stripeEvent = await StripeEvent.create({
        eventId: event.id,
        type: event.type,
        status: "processing"
      });
    } catch (error) {
      if (error.code === 11000) {
        console.log("DUPLICATE STRIPE EVENT:", event.id);
        return res.json({
          received: true,
          duplicate: true
        });
      }

      throw error;
    }

    const data = event.data.object;

    console.log("===== STRIPE WEBHOOK RECEIVED =====");
    console.log("EVENT ID:", event.id);
    console.log("EVENT TYPE:", event.type);
    console.log("DATA OBJECT ID:", data.id);
    console.log("DATA OBJECT STATUS:", data.status);
    console.log("PAYMENT STATUS:", data.payment_status);
    console.log("METADATA:", data.metadata);
    console.log("===================================");

    switch (event.type) {
      case "payment_intent.succeeded": {
        await markPaymentIntentOrderPaid(data);
        break;
      }

      case "payment_intent.payment_failed": {
        await markPaymentIntentOrderFailed(data);
        break;
      }

      case "charge.refunded": {
        await markOrderRefundedFromCharge(data);
        break;
      }

      default:
        console.log(`Unhandled Stripe event: ${event.type}`);
        break;
    }

    stripeEvent.status = "processed";
    stripeEvent.processedAt = new Date();
    await stripeEvent.save();

    return res.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook handling failed:", error.message);

    if (stripeEvent) {
      stripeEvent.status = "failed";
      stripeEvent.errorMessage = error.message;
      await stripeEvent.save().catch(() => {});
    }

    return res.status(500).json({
      message: "Webhook handling failed"
    });
  }
}

module.exports = { handleStripeWebhook };