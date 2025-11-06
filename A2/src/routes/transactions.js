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
// need to add adjustment transaction route here
router.get("/", getTransactions);
router.get("/:transactionId", getTransactionById);
router.patch("/:transactionId/suspicious", patchTransactionAsSuspiciousById);
router.patch("/:transactionId/processed", patchRedemptionTransactionStatusById);

export default router;