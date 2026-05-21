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

function getOrderIdFromSession(session) {
  return session?.metadata?.orderId;
}

async function sendOrderEmailSafe(order) {
  try {
    const data = await mailer.sendMail({
      to: order.customer.email,
      subject: "Your Manna Organics Order Confirmation",
      html: orderEmailTemplate(order)
    });

    console.log("EMAIL SENT SUCCESSFULLY:", data);
    return true;
  } catch (error) {
    console.error("Order email failed:", error.message);
    return false;
  }
}

async function markOrderPaid(session) {
  const orderId = getOrderIdFromSession(session);

  if (!orderId) {
    throw new Error("Missing orderId in Stripe session metadata");
  }

  const order = await Order.findById(orderId);

  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }

  if (order.paymentStatus === "paid") {
    return order;
  }

  order.paymentStatus = "paid";
  order.stripePaymentIntentId = session.payment_intent || order.stripePaymentIntentId;

  await order.save();

  console.log(`Payment successful for order ${orderId}. Sending confirmation email to ${order.customer.email}`);

  await sendOrderEmailSafe(order);

  console.log("Email function completed for:", order.customer.email);
  return order;
}

async function markOrderExpired(session) {
  const orderId = getOrderIdFromSession(session);

  if (!orderId) {
    throw new Error("Missing orderId in Stripe session metadata");
  }

  const order = await Order.findById(orderId);

  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }

  if (order.paymentStatus === "pending") {
    order.paymentStatus = "expired";
    await order.save();
  }

  return order;
}

async function markOrderFailed(session) {
  const orderId = getOrderIdFromSession(session);

  if (!orderId) {
    throw new Error("Missing orderId in Stripe session metadata");
  }

  const order = await Order.findById(orderId);

  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }

  if (order.paymentStatus !== "paid") {
    order.paymentStatus = "failed";
    await order.save();
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
        return res.json({
          received: true,
          duplicate: true
        });
      }

      throw error;
    }

    const data = event.data.object;
    console.log("EVENT TYPE:", event.type);
    console.log("PAYMENT STATUS:", data.payment_status);
    console.log("METADATA:", data.metadata);
    switch (event.type) {
      case "checkout.session.completed": {
        if (data.payment_status === "paid") {
          await markOrderPaid(data);
        }

        break;
      }

      case "checkout.session.async_payment_succeeded": {
        await markOrderPaid(data);
        break;
      }

      case "checkout.session.async_payment_failed": {
        await markOrderFailed(data);
        break;
      }

      case "checkout.session.expired": {
        await markOrderExpired(data);
        break;
      }

      case "payment_intent.payment_failed": {
        console.log("Payment intent failed:", data.id);
        break;
      }

      case "charge.refunded": {
        const paymentIntentId = data.payment_intent;

        if (paymentIntentId) {
          await Order.findOneAndUpdate(
            { stripePaymentIntentId: paymentIntentId },
            { paymentStatus: "refunded" }
          );
        }

        break;
      }

      default:
        console.log(`Unhandled Stripe event: ${event.type}`);
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
      await stripeEvent.save().catch(() => { });
    }

    return res.status(500).json({
      message: "Webhook handling failed"
    });
  }
}

module.exports = { handleStripeWebhook };