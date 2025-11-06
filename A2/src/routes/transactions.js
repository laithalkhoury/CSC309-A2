const express = require("express");

const {
    postTransaction,
    getTransactions,
    getTransactionById,
    patchTransactionAsSuspiciousById,
    patchRedemptionTransactionStatusById,
    adjustmentTransaction,
} = require("../controllers/transactionController.js");

const router = express.Router();

router.post("/", handleTransaction);
router.get("/", getTransactions);
router.get("/:transactionId", getTransactionById);
router.patch("/:transactionId/suspicious", patchTransactionAsSuspiciousById);
router.patch("/:transactionId/processed", patchRedemptionTransactionStatusById);


// Unified transaction handler to handle purchase AND adjustment transactions
const handleTransaction = async(req, res, next) => {
    try{
        const{type} = req.body;
        if(type === "purchase"){
            return await postTransaction(req, res);
        }
        else if(type === "adjustment"){
            return await adjustmentTransaction(req, res);
        }
        else{
            throw new Error("Bad Request");
        }
    } catch(error){
        next(error);    
    }   
    }



module.exports = router;