import express from "express";

import {
    postTransaction,
    getTransactions,
    getTransactionById,
    patchTransactionAsSuspiciousById,
    patchRedemptionTransactionStatusById,
} from "../controllers/transactionController.js";

const router = express.Router();

router.post("/", postTransaction);
router.get("/", getTransactions);
router.get("/:transactionId", getTransactionById);
router.patch("/:transactionId/suspicious", patchTransactionAsSuspiciousById);
router.patch("/redemptions/:transactionId/processed", patchRedemptionTransactionStatusById);

export default router;