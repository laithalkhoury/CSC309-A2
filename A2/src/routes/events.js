import express from "express";

import {
    postEvent,
    getEvents,
    getEventsAsManager,
    getEventById,
    getEventsAsManager,
    patchEventById,
    deleteEventById,
    postOrganizerToEvent,
    removeOrganizerFromEvent,
    postGuestToEvent,
    deleteGuestFromEvent,
    postCurrentUserToEvent,
    removeCurrentUserFromEvent,
    CreateRewardTransaction
} from "../controllers/authController.js";

const router = express.Router();

router.post("/", postEvent);

router.get("/", getEvents);

router.get("/", getEventsAsManager);

router.get("/:eventId", getEventById);

router.get("/:eventId", getEventsAsManager);

router.patch("/:eventId", patchEventById);

router.delete("/:eventId", deleteEventById);

router.post("/:eventId/organizers", postOrganizerToEvent);

router.delete("/:eventId/organizers/:userId", removeOrganizerFromEvent);

router.post("/:eventId/guests", postGuestToEvent);

router.delete("/:eventId/guests/:userId", deleteGuestFromEvent);

router.post("/:eventId/guests/me", postCurrentUserToEvent);

router.delete("/:eventId/guests/me", removeCurrentUserFromEvent);

router.post("/:eventId/transactions", CreateRewardTransaction);

export default router;
