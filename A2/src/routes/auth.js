const express = require("express");

const express = require("express");

const {
  authUser,
  requestPasswordReset,
  resetPassword,
} = require("../controllers/authController.js");

const router = express.Router();

// POST /auth/tokens - Authenticate user and issue token
router.post("/tokens", authUser);

// POST /auth/resets - Request password reset
router.post("/resets", requestPasswordReset);

// POST /auth/resets/:resetToken - Reset password
router.post("/resets/:resetToken", resetPassword);

module.exports = router;
