const express = require("express");

const {
    postPromotion,
    getPromotions,
    getPromotionById,
    patchPromotionById,
    deletePromotionById,
} = require("../controllers/promotionController.js");
const { authenticate, authenticateOptional, requires } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/", authenticate, requires("manager"), postPromotion);
router.get("/", authenticateOptional, getPromotions);
router.get("/:promotionId", authenticateOptional, getPromotionById);
router.patch("/:promotionId", authenticate, requires("manager"), patchPromotionById);
router.delete("/:promotionId", authenticate, requires("manager"), deletePromotionById);

module.exports = router;
