const express = require("express");

const {
  postTransaction,
  getTransactions,
  getTransactionById,
  patchTransactionAsSuspiciousById,
  patchRedemptionTransactionStatusById,
  adjustmentTransaction,
} = require("../controllers/transactionController.js");
const { authenticate, requires } = require("../middleware/authMiddleware");

const router = express.Router();

const handleTransaction = async (req, res, next) => {
  try {
    const { type } = req.body;
    if (type === "purchase") {
      return requires("cashier")(req, res, () => postTransaction(req, res, next));
    }
    if (type === "adjustment") {
      return requires("manager")(req, res, () => adjustmentTransaction(req, res, next));
    }

    throw new Error("Bad Request");
  } catch (error) {
    next(error);
  }
};

router.post("/", authenticate, handleTransaction);
router.get("/", authenticate, requires("manager"), getTransactions);
router.get(
  "/:transactionId",
  authenticate,
  requires("manager"),
  getTransactionById
);
router.patch(
  "/:transactionId/suspicious",
  authenticate,
  requires("manager"),
  patchTransactionAsSuspiciousById
);
router.patch(
  "/:transactionId/processed",
  authenticate,
  requires("cashier"),
  patchRedemptionTransactionStatusById
);

module.exports = router;