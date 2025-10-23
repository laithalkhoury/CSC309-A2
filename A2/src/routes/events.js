import express from "express";

import {
    postEvent,
    getEvents,
    getEventById,
    patchEventById,
    deleteEventById,
    postOrganizerToEvent,
    removeOrganizerFromEvent,
    postGuestToEvent,
    deleteGuestFromEvent,
    postCurrentUserToEvent,
    removeCurrentUserFromEvent,
    createRewardTransaction
} from "../controllers/eventController.js";

const router = express.Router();

router.post("/", postEvent);

router.get("/", getEvents);

router.get("/:eventId", getEventById);

router.patch("/:eventId", patchEventById);

router.delete("/:eventId", deleteEventById);

router.post("/:eventId/organizers", postOrganizerToEvent);

router.delete("/:eventId/organizers/:userId", removeOrganizerFromEvent);

router.post("/:eventId/guests", postGuestToEvent);

router.delete("/:eventId/guests/:userId", deleteGuestFromEvent);

router.post("/:eventId/guests/me", postCurrentUserToEvent);

router.delete("/:eventId/guests/me", removeCurrentUserFromEvent);

router.post("/:eventId/transactions", createRewardTransaction);

export default router;
