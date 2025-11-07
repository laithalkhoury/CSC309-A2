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

// Managers or superusers can create events
router.post("/", authenticate, requires("manager"), postEvent);

// All authenticated users can view events
router.get("/", authenticate, getEvents);
router.get("/:eventId", authenticate, getEventById);

// Managers can manage events
router.patch("/:eventId", authenticate, requires("manager"), patchEventById);
router.delete("/:eventId", authenticate, requires("manager"), deleteEventById);

router.post("/:eventId/organizers", authenticate, requires("manager"), postOrganizerToEvent);
router.delete("/:eventId/organizers/:userId", authenticate, requires("manager"), removeOrganizerFromEvent);

router.post("/:eventId/guests", authenticate, requires("manager"), postGuestToEvent);
router.delete("/:eventId/guests/:userId", authenticate, requires("manager"), deleteGuestFromEvent);

// Regular users RSVP to events
router.post("/:eventId/guests/me", authenticate, postCurrentUserToEvent);
router.delete("/:eventId/guests/me", removeCurrentUserFromEvent);

// Award points after events
router.post("/:eventId/transactions", authenticate, requires("manager"), createRewardTransaction);

module.exports = router;
