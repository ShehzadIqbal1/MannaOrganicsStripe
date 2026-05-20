const Order = require("../models/Order");

async function getAllOrders(req, res) {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json({ count: orders.length, orders });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch orders" });
  }
}

module.exports = { getAllOrders };