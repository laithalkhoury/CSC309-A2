const express = require("express");

const {
    postPromotion,
    getPromotions,
    getPromotionById,
    patchPromotionById,
    deletePromotionById,
} = require("../controllers/promotionController.js");

const router = express.Router();

router.post("/", postPromotion);
router.get("/", getPromotions);
router.get("/:promotionId", getPromotionById);
router.patch("/:promotionId", patchPromotionById);
router.delete("/:promotionId", deletePromotionById);

module.exports = router;
