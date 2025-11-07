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
const { authenticate } = require("../middleware/authMiddleware");

const router = express.Router();

// Managers or superusers can create events
router.post("/", authenticate, postEvent);

// All authenticated users can view events
router.get("/", authenticate, getEvents);
router.get("/:eventId", authenticate, getEventById);

// Managers can manage events
router.patch("/:eventId", authenticate, patchEventById);
router.delete("/:eventId", authenticate, deleteEventById);

router.post("/:eventId/organizers", authenticate, postOrganizerToEvent);
router.delete("/:eventId/organizers/:userId", authenticate, removeOrganizerFromEvent);

router.post("/:eventId/guests", authenticate, postGuestToEvent);
router.delete("/:eventId/guests/:userId", authenticate, deleteGuestFromEvent);

// Regular users RSVP to events
router.post("/:eventId/guests/me", authenticate, postCurrentUserToEvent);
router.delete("/:eventId/guests/me", authenticate, removeCurrentUserFromEvent);

// Award points after events
router.post("/:eventId/transactions", authenticate, createRewardTransaction);

module.exports = router;
