require("dotenv").config();
const bcrypt = require("bcryptjs");
const connectDB = require("../config/db");
const Admin = require("../models/Admin");
const dns = require('node:dns'); 
dns.setServers(['8.8.8.8', '1.1.1.1']);

async function seedAdmin() {
  await connectDB();

  const email = process.env.ADMIN_SEED_EMAIL.toLowerCase();
  const password = process.env.ADMIN_SEED_PASSWORD;

  const existingAdmin = await Admin.findOne({ email });

  if (existingAdmin) {
    console.log("Admin already exists");
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await Admin.create({
    email,
    passwordHash
  });

  console.log("Admin created successfully");
  process.exit(0);
}

seedAdmin();