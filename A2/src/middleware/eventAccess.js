// middleware/eventAccess.js

const prisma = require("../prismaClient");

/**
 * Middleware that allows access to:
 * - superusers
 * - managers
 * - organizers of the event
 */
function canManageEvent() {
  return async (req, res, next) => {
    try {
      const me = req.me;
      if (!me) return res.status(401).json({ error: "Unauthorized" });

      const eventId = Number(req.params.eventId);
      if (!Number.isInteger(eventId) || eventId <= 0)
        return res.status(400).json({ error: "Bad Request" });

      const event = await prisma.event.findUnique({
        where: { id: eventId },
        include: { organizers: { select: { id: true } } },
      });
      if (!event) return res.status(404).json({ error: "Not Found" });

      const isOrganizer = event.organizers.some((o) => o.id === me.id);
      if (["superuser", "manager"].includes(me.role) || isOrganizer) {
        req.event = event;
        return next();
      }
      return res.status(403).json({ error: "Forbidden" });
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { canManageEvent };
