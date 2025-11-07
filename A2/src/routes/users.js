const express = require("express");
const router = express.Router();

const { authenticate, requires } = require("../middleware/authMiddleware");

const {
  postUser,
  getUsers,
  getCurrentUser,
  patchCurrentUser,
  patchCurrentUserPassword,
  postRedemptionTransaction,
  getCurrentUserTransactions,
  getUserById,
  patchUserById,
  getUserTransactions,
  postTransferTransaction,
} = require("../controllers/userController");

// POST /users - Register a new user (cashier or higher)
router.post("/", authenticate, requires("cashier"), postUser);

// GET /users - Retrieve a list of users (manager or higher)
router.get("/", authenticate, requires("manager"), getUsers);

// GET /users/me - Get current authenticated user (regular or higher)
router.get("/me", authenticate, getCurrentUser);

// PATCH /users/me - Update current user's info (regular or higher)
router.patch("/me", authenticate, patchCurrentUser);

// PATCH /users/me/password - Update current user's password (regular or higher)
router.patch("/me/password", authenticate, patchCurrentUserPassword);

// POST /users/me/transactions - Create a redemption transaction (regular or higher)
router.post("/me/transactions", authenticate, postRedemptionTransaction);

// GET /users/me/transactions - Get current user's transactions (regular or higher)
router.get("/me/transactions", authenticate, getCurrentUserTransactions);

// GET /users/:userId - Retrieve a specific user
// (cashier or higher; managers/superusers will see extended fields in the controller)
router.get("/:userId", authenticate, requires("cashier"), getUserById);

// PATCH /users/:userId - Update a specific user's data (manager or higher)
router.patch("/:userId", authenticate, requires("manager"), patchUserById);

// GET /users/:userId/transactions - Get user's transactions (cashier or higher)
router.get("/:userId/transactions", authenticate, requires("cashier"), getUserTransactions);

// POST /users/:userId/transactions - Create a transfer (regular or higher; sender = current user)
router.post("/:userId/transactions", authenticate, postTransferTransaction);

module.exports = router;