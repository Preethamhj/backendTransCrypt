const express = require("express");
const router = express.Router();
const User = require("../models/auth");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "yourSuperSecretKey123";
const ONLINE_TIMEOUT = parseInt(process.env.ONLINE_TIMEOUT) || 120000;

let onlineUsers = {};

// ----------------- REGISTER -----------------
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ msg: "All fields required" });

    if (await User.findOne({ email })) return res.status(400).json({ msg: "Email exists" });

    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashed });
    await user.save();

    res.json({ msg: "Registered successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
});

// ----------------- LOGIN -----------------
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ msg: "Email & password required" });

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ msg: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ msg: "Invalid credentials" });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ msg: "Login success", token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
});

// ----------------- ONLINE USERS -----------------
router.post("/online", (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ msg: "Email required" });

  onlineUsers[email] = Date.now();
  console.log(`${email} is online`);
  res.json({ msg: `${email} marked online.` });
});

router.get("/online", (req, res) => {
  const now = Date.now();
  const list = [];
  for (const email in onlineUsers) {
    if (now - onlineUsers[email] <= ONLINE_TIMEOUT) list.push(email);
  }
  res.json({ onlineUsers: list });
});

// Cleanup offline users
setInterval(() => {
  const now = Date.now();
  for (const email in onlineUsers) {
    if (now - onlineUsers[email] > ONLINE_TIMEOUT) {
      console.log(`${email} is offline`);
      delete onlineUsers[email];
    }
  }
}, 30000);

module.exports = router;
