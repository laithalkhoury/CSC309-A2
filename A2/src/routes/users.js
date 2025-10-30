import express from "express";

import {
  postUser,
  getUsers,
  getUserById,
  patchUserById,
  getCurrentUser,
  patchCurrentUser,
  patchCurrentUserPassword,
  getUserTransactions,
  postTransferTransaction,
  getCurrentUserTransactions,
  postRedemptionTransaction,
} from "../controllers/usersController.js";

const router = express.Router();

// POST /users - Register a new user
router.post("/", postUser);

// GET /users - Retrieve a list of users (manager or higher)
router.get("/", getUsers);

// GET /users/me - Get current authenticated user
router.get("/me", getCurrentUser);

// PATCH /users/me - Update current user's info
router.patch("/me", patchCurrentUser);

// PATCH /users/me/password - Update current user's password
router.patch("/me/password", patchCurrentUserPassword);

// POST /users/:userId/redemptions - Create a new redemption transaction for the current user
router.post("/me/transactions", postRedemptionTransaction);

router.get("/me/transactions", getCurrentUserTransactions);

// GET /users/:userId - Retrieve a single user by ID
router.get("/:userId", getUserById);

// PATCH /users/:userId - Update a specific user's data (manager/superuser)
router.patch("/:userId", patchUserById);

// GET /users/:userId/transactions - Get user's transactions
router.get("/:userId/transactions", getUserTransactions);

// POST /users/:userId/transactions - Create a new transfer transaction between the current logged-in user (sender) and the user specified by userId (the recipient)
router.post("/:userId/transactions", postTransferTransaction);

export default router;
