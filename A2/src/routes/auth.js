import express from "express";

import {
    authUser,
    reqPasswordReset,
    resetPassword,
} from "../controllers/authController.js";

const router = express.Router();

// POST /auth/tokens - Authenticate user and issue token
router.post("/tokens", authUser);

// POST /auth/resets - Request password reset
router.post("/resets", reqPasswordReset);

// POST /auth/resets/:resetToken - Reset password
router.post("/resets/:resetToken", resetPassword);

export default router;
