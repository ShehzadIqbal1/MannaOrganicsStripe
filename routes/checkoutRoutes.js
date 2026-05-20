const express = require("express");
const { createCheckoutSession } = require("../controllers/checkoutController");

const router = express.Router();

router.post("/create-checkout-session", createCheckoutSession);

module.exports = router;