const express = require("express");
const { authenticate, requires} =  require("../middleware/authMiddleware.js");
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
} = require("../controllers/userController.js");

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
router.patch("/:userId", authenticate, requires("manager"), patchUserById);

// GET /users/:userId/transactions - Get user's transactions
router.get("/:userId/transactions", getUserTransactions);

// POST /users/:userId/transactions - Create a new transfer transaction between the current logged-in user (sender) and the user specified by userId (the recipient)
router.post("/:userId/transactions", postTransferTransaction);

module.exports = router;
