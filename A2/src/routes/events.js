// routes/events.js

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
const { authenticate, requires, attachUser } = require("../middleware/authMiddleware");
const { canManageEvent } = require("../middleware/eventAccess");

const router = express.Router();

// Apply authenticate + attachUser for all event routes
router.use(authenticate, attachUser);

// Managers or superusers can create events
router.post("/", requires("manager"), postEvent);

// All authenticated users can view events
router.get("/", getEvents);
router.get("/:eventId", getEventById);

// Managers / organizers / superusers can manage event
router.patch("/:eventId", canManageEvent(), patchEventById);
router.delete("/:eventId", canManageEvent(), deleteEventById);

router.post("/:eventId/organizers", canManageEvent(), postOrganizerToEvent);
router.delete("/:eventId/organizers/:userId", canManageEvent(), removeOrganizerFromEvent);

router.post("/:eventId/guests", canManageEvent(), postGuestToEvent);
router.delete("/:eventId/guests/:userId", canManageEvent(), deleteGuestFromEvent);

// Regular users RSVP to events
router.post("/:eventId/guests/me", postCurrentUserToEvent);
router.delete("/:eventId/guests/me", removeCurrentUserFromEvent);

// Award points after events
router.post("/:eventId/transactions", canManageEvent(), createRewardTransaction);

module.exports = router;
