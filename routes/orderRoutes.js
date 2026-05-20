const express = require("express");
const { getAllOrders } = require("../controllers/orderController");
const requireAdmin = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireAdmin, getAllOrders);

module.exports = router;