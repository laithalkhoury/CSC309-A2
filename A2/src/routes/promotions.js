const express = require("express");

const {
    postPromotion,
    getPromotions,
    getPromotionById,
    patchPromotionById,
    deletePromotionById,
} = require("../controllers/promotionController.js");
const { authenticate, authenticateOptional } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/", authenticate, postPromotion);
router.get("/", authenticateOptional, getPromotions);
router.get("/:promotionId", authenticateOptional, getPromotionById);
router.patch("/:promotionId", authenticate, patchPromotionById);
router.delete("/:promotionId", authenticate, deletePromotionById);

module.exports = router;
