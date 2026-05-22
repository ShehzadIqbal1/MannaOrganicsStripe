const express = require("express");
const { createPaymentIntent } = require("../controllers/checkoutController");

const router = express.Router();

router.post("/create-payment-intent", createPaymentIntent);

module.exports = router;