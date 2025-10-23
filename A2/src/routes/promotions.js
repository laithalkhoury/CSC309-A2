import express from "express";

import {
    postPromotion,
    getPromotions,
    getPromotionById,
    patchPromotionById,
    deletePromotionById,
} from "../controllers/promotionController.js";

const router = express.Router();

router.post("/", postPromotion);
router.get("/", getPromotions);
router.get("/:promotionId", getPromotionById);
router.patch("/:promotionId", patchPromotionById);
router.delete("/:promotionId", deletePromotionById);

export default router;
