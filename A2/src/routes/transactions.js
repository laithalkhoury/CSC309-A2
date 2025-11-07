const express = require("express");

const {
    postTransaction,
    getTransactions,
    getTransactionById,
    patchTransactionAsSuspiciousById,
    patchRedemptionTransactionStatusById,
    adjustmentTransaction,
} = require("../controllers/transactionController.js");
const { authenticate } = require("../middleware/authMiddleware");

const router = express.Router();

// Unified transaction handler to handle purchase AND adjustment transactions
const handleTransaction = async (req, res, next) => {
    try {
        const { type } = req.body;
        if (type === "purchase") {
            return await postTransaction(req, res, next);
        }
        else if (type === "adjustment") {
            return await adjustmentTransaction(req, res, next);
        }
        else {
            throw new Error("Bad Request");
        }
    } catch (error) {
        next(error);
    }
}

router.post("/", authenticate, handleTransaction);
router.get("/", authenticate, getTransactions);
router.get("/:transactionId", authenticate, getTransactionById);
router.patch("/:transactionId/suspicious", authenticate, patchTransactionAsSuspiciousById);
router.patch("/:transactionId/processed", authenticate, patchRedemptionTransactionStatusById);



module.exports = router;