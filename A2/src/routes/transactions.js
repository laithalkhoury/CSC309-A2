import express from "express";

import {
    postTransaction,
    postAdjustmentTransaction,
    getTransactions,
    getTransactionById,
    patchTransactionAsSuspiciousById,
    getCurrentUserTransactions,
    patchRedemptionTransactionStatusById,
} from "../controllers/transactionController.js";

const router = express.Router();

router.post("/", postTransaction);
router.post("/", postAdjustmentTransaction);
router.get("/", getTransactions);
router.get("/:transactionId", getTransactionById);
router.patch("/:transactionId/suspicious", patchTransactionAsSuspiciousById);
router.get("/current", getCurrentUserTransactions);
router.patch("/redemptions/:transactionId/processed", patchRedemptionTransactionStatusById);

export default router;