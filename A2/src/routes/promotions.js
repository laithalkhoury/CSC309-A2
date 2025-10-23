import express from "express";

import {
    postPromotion,
    getPromotions,
    getPromotionAsManager,
    getPromotionById,
    patchPromotionById,
    deletePromotionById,
} from "../controllers/authController.js";

const router = express.Router();

router.post("/", postPromotion);
router.get("/", getPromotions);
router.get("/", getPromotionAsManager);
router.get("/:promotionId", getPromotionById);
router.patch("/:promotionId", patchPromotionById);
router.delete("/:promotionId", deletePromotionById);

export default router;
