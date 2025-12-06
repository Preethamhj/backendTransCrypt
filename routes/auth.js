const express = require("express");
const router = express.Router();
const User = require("../models/auth");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// REGISTER
router.post("/register", async (req, res) => {
    try {
        const { name, email, password } = req.body;

        const exists = await User.findOne({ email });
        if (exists) return res.status(400).json({ msg: "Email already exists" });

        const hashed = await bcrypt.hash(password, 10);

        const user = new User({ name, email, password: hashed });
        await user.save();

        res.json({ msg: "User registered successfully" });
    } catch (err) {
        res.status(500).json({ msg: "Server error" });
    }
});

// LOGIN
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ msg: "Invalid credentials" });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ msg: "Invalid credentials" });

        const token = jwt.sign({ id: user._id }, "SECRET123", { expiresIn: "7d" });

        res.json({ msg: "Login success", token });
    } catch (err) {
        res.status(500).json({ msg: "Server error" });
    }
});

let onlineUsers = {};

// POST /online - mark user online
router.post('/online', (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ msg: 'Email is required' });
  }

  // Mark the user as online with current timestamp
  onlineUsers[email] = Date.now();
  console.log(`${email} is now online.`);

  return res.status(200).json({ msg: `${email} marked online.` });
});

// GET /online - list all online users
router.get('/online', (req, res) => {
  const now = Date.now();
  const onlineList = [];

  // Filter users active in last 20 seconds
  for (const email in onlineUsers) {
    if (now - onlineUsers[email] <= 20000) {
      onlineList.push(email);
    }
  }

  return res.status(200).json({ onlineUsers: onlineList });
});

// Background cleanup to remove users offline for more than 20s
setInterval(() => {
  const now = Date.now();
  for (const email in onlineUsers) {
    if (now - onlineUsers[email] > 20000) {
      console.log(`${email} is now offline.`);
      delete onlineUsers[email];
    }
  }
}, 5000);
module.exports = router;
