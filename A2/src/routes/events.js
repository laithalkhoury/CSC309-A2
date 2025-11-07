const express = require("express");

const {
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
  createRewardTransaction,
} = require("../controllers/eventController.js");
const { authenticate, requires } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/", authenticate, requires("manager"), postEvent);

router.get("/", authenticate, getEvents);

router.get("/:eventId", authenticate, getEventById);

router.patch("/:eventId", authenticate, patchEventById);

router.delete("/:eventId", authenticate, requires("manager"), deleteEventById);

router.post(
  "/:eventId/organizers",
  authenticate,
  requires("manager"),
  postOrganizerToEvent
);

router.delete(
  "/:eventId/organizers/:userId",
  authenticate,
  requires("manager"),
  removeOrganizerFromEvent
);

router.post("/:eventId/guests", authenticate, postGuestToEvent);

router.delete(
  "/:eventId/guests/:userId",
  authenticate,
  requires("manager"),
  deleteGuestFromEvent
);

router.post("/:eventId/guests/me", authenticate, postCurrentUserToEvent);

router.delete("/:eventId/guests/me", authenticate, removeCurrentUserFromEvent);

router.post("/:eventId/transactions", authenticate, createRewardTransaction);

module.exports = router;
