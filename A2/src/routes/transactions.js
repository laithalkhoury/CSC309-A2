const express = require("express");

const {
    postTransaction,
    getTransactions,
    getTransactionById,
    patchTransactionAsSuspiciousById,
    patchRedemptionTransactionStatusById,
    adjustmentTransaction,
    redemptionTransaction,
    transferTransaction,
} = require("../controllers/transactionController.js");
const { authenticate, requires } = require("../middleware/authMiddleware");

const router = express.Router();

// Unified transaction handler to handle purchase AND adjustment transactions
const handleTransaction = async (req, res, next) => {
    try {
        const { type } = req.body ?? {};

        if (type === "purchase") {
            return await postTransaction(req, res, next);
        }

        if (type === "adjustment") {
            if (!req.me || (req.me.role !== "manager" && req.me.role !== "superuser")) {
                throw new Error("Forbidden");
            }
            return await adjustmentTransaction(req, res, next);
        }

        if (type === "redemption") {
            return await redemptionTransaction(req, res, next);
        }

        if (type === "transfer") {
            return await transferTransaction(req, res, next);
        }

        throw new Error("Bad Request");
    } catch (error) {
        next(error);
    }
}

router.post("/", authenticate, requires("cashier"), handleTransaction);
router.get("/", authenticate, requires("manager"), getTransactions);
router.get("/:transactionId", authenticate, requires("manager"), getTransactionById);
router.patch("/:transactionId/suspicious", authenticate, requires("manager"), patchTransactionAsSuspiciousById);
router.patch("/:transactionId/processed", authenticate, requires("cashier"), patchRedemptionTransactionStatusById);



module.exports = router;