const prisma = require("../prismaClient");

const parseEventDate = (value) => {
  const date = new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error("Bad Request");
  }
  return date;
};

const isManager = (user) => user.role === "manager" || user.role === "superuser";

const eventToResponse = (event, { includeDetails = false } = {}) => {
  const base = {
    id: event.id,
    name: event.name,
    description: event.description,
    location: event.location,
    startTime: event.startTime.toISOString(),
    endTime: event.endTime.toISOString(),
    capacity: event.capacity,
    published: event.published,
    numGuests: event._count ? event._count.guests : event.guests?.length || 0,
  };

  if (includeDetails) {
    base.points = event.points;
    base.pointsRemain = event.pointsRemain;
    base.pointsAwarded = event.pointsAwarded;
    base.organizers = event.organizers
      ? event.organizers.map((o) => ({ id: o.id, utorid: o.utorid, name: o.name }))
      : [];
    base.guests = event.guests
      ? event.guests.map((g) => ({ id: g.id, utorid: g.utorid, name: g.name }))
      : [];
  }

  return base;
};

const validateEventPayload = (body, { partial = false } = {}) => {
  const {
    name,
    description,
    location,
    startTime,
    endTime,
    capacity,
    points,
    published,
  } = body;

  if (!partial) {
    if (!name || !description || !location || !startTime || !endTime || points === undefined) {
      throw new Error("Bad Request");
    }
  }

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0 || name.length > 150) {
      throw new Error("Bad Request");
    }
  }

  if (description !== undefined) {
    if (
      typeof description !== "string" ||
      description.trim().length === 0 ||
      description.length > 2000
    ) {
      throw new Error("Bad Request");
    }
  }

  if (location !== undefined) {
    if (typeof location !== "string" || location.trim().length === 0 || location.length > 255) {
      throw new Error("Bad Request");
    }
  }

  if (capacity !== undefined) {
    if (capacity !== null) {
      if (!Number.isInteger(capacity) || capacity <= 0) {
        throw new Error("Bad Request");
      }
    }
  }

  if (points !== undefined) {
    if (!Number.isInteger(points) || points < 0) {
      throw new Error("Bad Request");
    }
  }

  if (published !== undefined && typeof published !== "boolean") {
    throw new Error("Bad Request");
  }

  let start;
  let end;

  if (startTime !== undefined) {
    start = parseEventDate(startTime);
  }

  if (endTime !== undefined) {
    end = parseEventDate(endTime);
  }

  if (start && end && end <= start) {
    throw new Error("Bad Request");
  }

  return { start, end };
};

const ensureOrganizerOrManager = (event, user) => {
  if (!user) throw new Error("Unauthorized");
  if (isManager(user)) return true;
  if (event.organizers.some((o) => o.id === user.id)) return true;
  throw new Error("Forbidden");
};

const postEvent = async (req, res, next) => {
  try {
    const me = req.me;
    if (!me || !isManager(me)) throw new Error("Forbidden");

    const { start, end } = validateEventPayload(req.body);

    const event = await prisma.event.create({
      data: {
        name: req.body.name.trim(),
        description: req.body.description.trim(),
        location: req.body.location.trim(),
        startTime: start,
        endTime: end,
        capacity: req.body.capacity ?? null,
        points: req.body.points,
        pointsRemain: req.body.points,
        published: req.body.published ?? false,
        createdById: me.id,
      },
      include: {
        organizers: { select: { id: true, utorid: true, name: true } },
        guests: { select: { id: true } },
        _count: { select: { guests: true } },
      },
    });

    return res.status(201).json(eventToResponse(event, { includeDetails: true }));
  } catch (err) {
    next(err);
  }
};

const getEvents = async (req, res, next) => {
  try {
    const me = req.me;
    if (!me) throw new Error("Unauthorized");

    const {
      name,
      location,
      started,
      ended,
      showFull,
      published,
      page = 1,
      limit = 10,
    } = req.query;

    const pageNum = Number.parseInt(page, 10);
    const limitNum = Number.parseInt(limit, 10);
    if (!Number.isInteger(pageNum) || pageNum <= 0) throw new Error("Bad Request");
    if (!Number.isInteger(limitNum) || limitNum <= 0 || limitNum > 100) {
      throw new Error("Bad Request");
    }

    const now = new Date();
    const where = {};

    if (name) {
      where.name = { contains: name, mode: "insensitive" };
    }

    if (location) {
      where.location = { contains: location, mode: "insensitive" };
    }

    if (started !== undefined) {
      if (started !== "true" && started !== "false") throw new Error("Bad Request");
      where.startTime = started === "true" ? { lte: now } : { gt: now };
    }

    if (ended !== undefined) {
      if (ended !== "true" && ended !== "false") throw new Error("Bad Request");
      where.endTime = ended === "true" ? { lt: now } : { gte: now };
    }

    if (isManager(me)) {
      if (published !== undefined) {
        if (published !== "true" && published !== "false") {
          throw new Error("Bad Request");
        }
        where.published = published === "true";
      }
    } else {
      where.published = true;
    }

    const events = await prisma.event.findMany({
      where,
      include: {
        _count: { select: { guests: true } },
        organizers: { select: { id: true } },
        guests: false,
      },
      orderBy: { startTime: "asc" },
    });

    const includeFull = showFull === "true";
    const filtered = events.filter((event) => {
      if (includeFull) return true;
      if (event.capacity === null) return true;
      return event._count.guests < event.capacity;
    });

    const total = filtered.length;
    const startIndex = (pageNum - 1) * limitNum;
    const paginated = filtered.slice(startIndex, startIndex + limitNum);

    const results = paginated.map((event) =>
      eventToResponse(event, { includeDetails: isManager(me) })
    );

    return res.status(200).json({ count: total, results });
  } catch (err) {
    next(err);
  }
};

const getEventById = async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.eventId, 10);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Bad Request");

    const me = req.me;
    if (!me) throw new Error("Unauthorized");

    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        organizers: { select: { id: true, utorid: true, name: true } },
        guests: { select: { id: true, utorid: true, name: true } },
        _count: { select: { guests: true } },
      },
    });

    if (!event) throw new Error("Not Found");

    const isOrganizer = event.organizers.some((o) => o.id === me.id);

    if (!event.published && !isManager(me) && !isOrganizer) {
      throw new Error("Not Found");
    }

    const includeDetails = isManager(me) || isOrganizer;
    return res.status(200).json(eventToResponse(event, { includeDetails }));
  } catch (err) {
    next(err);
  }
};

const patchEventById = async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.eventId, 10);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Bad Request");

    if (Object.keys(req.body).length === 0) throw new Error("Bad Request");

    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        organizers: { select: { id: true } },
        guests: { select: { id: true } },
      },
    });
    if (!event) throw new Error("Not Found");

    ensureOrganizerOrManager(event, req.me);

    const { start, end } = validateEventPayload(req.body, { partial: true });

    const data = {};
    if (req.body.name !== undefined) data.name = req.body.name.trim();
    if (req.body.description !== undefined)
      data.description = req.body.description.trim();
    if (req.body.location !== undefined) data.location = req.body.location.trim();
    if (start) data.startTime = start;
    if (end) data.endTime = end;
    if (req.body.capacity !== undefined) data.capacity = req.body.capacity ?? null;
    if (req.body.published !== undefined) data.published = req.body.published;

    if (req.body.points !== undefined) {
      if (req.body.points < event.pointsAwarded) {
        throw new Error("Bad Request");
      }
      data.points = req.body.points;
      data.pointsRemain = req.body.points - event.pointsAwarded;
    }

    if (
      data.capacity !== undefined &&
      data.capacity !== null &&
      event.guests.length > data.capacity
    ) {
      throw new Error("Bad Request");
    }

    const updated = await prisma.event.update({
      where: { id },
      data,
      include: {
        organizers: { select: { id: true, utorid: true, name: true } },
        guests: { select: { id: true, utorid: true, name: true } },
        _count: { select: { guests: true } },
      },
    });

    const includeDetails = isManager(req.me) || updated.organizers.some((o) => o.id === req.me.id);
    return res.status(200).json(eventToResponse(updated, { includeDetails }));
  } catch (err) {
    next(err);
  }
};

const deleteEventById = async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.eventId, 10);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Bad Request");

    const me = req.me;
    if (!me || !isManager(me)) throw new Error("Forbidden");

    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) throw new Error("Not Found");

    if (event.published) {
      throw new Error("Bad Request");
    }

    await prisma.event.delete({ where: { id } });
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
};

const postOrganizerToEvent = async (req, res, next) => {
  try {
    const eventId = Number.parseInt(req.params.eventId, 10);
    if (!Number.isInteger(eventId) || eventId <= 0) throw new Error("Bad Request");

    const me = req.me;
    if (!me || !isManager(me)) throw new Error("Forbidden");

    const { utorid } = req.body;
    if (!utorid || typeof utorid !== "string") throw new Error("Bad Request");

    const user = await prisma.user.findUnique({ where: { utorid } });
    if (!user) throw new Error("Not Found");

    const event = await prisma.event.update({
      where: { id: eventId },
      data: {
        organizers: {
          connect: { id: user.id },
        },
      },
      include: {
        organizers: { select: { id: true, utorid: true, name: true } },
        guests: { select: { id: true, utorid: true, name: true } },
        _count: { select: { guests: true } },
      },
    });

    return res.status(200).json(eventToResponse(event, { includeDetails: true }));
  } catch (err) {
    if (err.code === "P2025") {
      return next(new Error("Not Found"));
    }
    next(err);
  }
};

const removeOrganizerFromEvent = async (req, res, next) => {
  try {
    const eventId = Number.parseInt(req.params.eventId, 10);
    const userId = Number.parseInt(req.params.userId, 10);
    if (!Number.isInteger(eventId) || eventId <= 0) throw new Error("Bad Request");
    if (!Number.isInteger(userId) || userId <= 0) throw new Error("Bad Request");

    const me = req.me;
    if (!me || !isManager(me)) throw new Error("Forbidden");

    const event = await prisma.event.update({
      where: { id: eventId },
      data: {
        organizers: {
          disconnect: { id: userId },
        },
      },
      include: {
        organizers: { select: { id: true, utorid: true, name: true } },
        guests: { select: { id: true, utorid: true, name: true } },
        _count: { select: { guests: true } },
      },
    });

    return res.status(200).json(eventToResponse(event, { includeDetails: true }));
  } catch (err) {
    if (err.code === "P2025") {
      return next(new Error("Not Found"));
    }
    next(err);
  }
};

const postGuestToEvent = async (req, res, next) => {
  try {
    const eventId = Number.parseInt(req.params.eventId, 10);
    if (!Number.isInteger(eventId) || eventId <= 0) throw new Error("Bad Request");

    const me = req.me;
    if (!me) throw new Error("Unauthorized");

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        organizers: { select: { id: true } },
        guests: { select: { id: true } },
        _count: { select: { guests: true } },
      },
    });
    if (!event) throw new Error("Not Found");

    if (!isManager(me) && !event.organizers.some((o) => o.id === me.id)) {
      throw new Error("Forbidden");
    }

    const { utorid } = req.body;
    if (!utorid || typeof utorid !== "string") throw new Error("Bad Request");

    const user = await prisma.user.findUnique({ where: { utorid } });
    if (!user) throw new Error("Not Found");

    if (event.guests.some((g) => g.id === user.id)) {
      return res.status(200).json(eventToResponse(event, { includeDetails: true }));
    }

    if (event.capacity !== null && event._count.guests >= event.capacity) {
      throw new Error("Bad Request");
    }

    const updated = await prisma.event.update({
      where: { id: eventId },
      data: {
        guests: { connect: { id: user.id } },
      },
      include: {
        organizers: { select: { id: true, utorid: true, name: true } },
        guests: { select: { id: true, utorid: true, name: true } },
        _count: { select: { guests: true } },
      },
    });

    return res.status(200).json(eventToResponse(updated, { includeDetails: true }));
  } catch (err) {
    if (err.code === "P2025") {
      return next(new Error("Not Found"));
    }
    next(err);
  }
};

const deleteGuestFromEvent = async (req, res, next) => {
  try {
    const eventId = Number.parseInt(req.params.eventId, 10);
    const userId = Number.parseInt(req.params.userId, 10);
    if (!Number.isInteger(eventId) || eventId <= 0) throw new Error("Bad Request");
    if (!Number.isInteger(userId) || userId <= 0) throw new Error("Bad Request");

    const me = req.me;
    if (!me || !isManager(me)) throw new Error("Forbidden");

    const updated = await prisma.event.update({
      where: { id: eventId },
      data: {
        guests: { disconnect: { id: userId } },
      },
      include: {
        organizers: { select: { id: true, utorid: true, name: true } },
        guests: { select: { id: true, utorid: true, name: true } },
        _count: { select: { guests: true } },
      },
    });

    return res.status(200).json(eventToResponse(updated, { includeDetails: true }));
  } catch (err) {
    if (err.code === "P2025") {
      return next(new Error("Not Found"));
    }
    next(err);
  }
};

const postCurrentUserToEvent = async (req, res, next) => {
  try {
    const eventId = Number.parseInt(req.params.eventId, 10);
    if (!Number.isInteger(eventId) || eventId <= 0) throw new Error("Bad Request");

    const me = req.me;
    if (!me) throw new Error("Unauthorized");

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        guests: { select: { id: true } },
        _count: { select: { guests: true } },
      },
    });
    if (!event) throw new Error("Not Found");

    if (!event.published) throw new Error("Forbidden");
    if (event.capacity !== null && event._count.guests >= event.capacity) {
      throw new Error("Bad Request");
    }

    if (event.guests.some((g) => g.id === me.id)) {
      return res.status(200).json({ message: "Already RSVP'd" });
    }

    await prisma.event.update({
      where: { id: eventId },
      data: {
        guests: { connect: { id: me.id } },
      },
    });

    return res.status(200).json({ message: "RSVP confirmed" });
  } catch (err) {
    next(err);
  }
};

const removeCurrentUserFromEvent = async (req, res, next) => {
  try {
    const eventId = Number.parseInt(req.params.eventId, 10);
    if (!Number.isInteger(eventId) || eventId <= 0) throw new Error("Bad Request");

    const me = req.me;
    if (!me) throw new Error("Unauthorized");

    await prisma.event.update({
      where: { id: eventId },
      data: {
        guests: { disconnect: { id: me.id } },
      },
    });

    return res.status(200).json({ message: "RSVP cancelled" });
  } catch (err) {
    if (err.code === "P2025") {
      return next(new Error("Not Found"));
    }
    next(err);
  }
};

const createRewardTransaction = async (req, res, next) => {
  try {
    const eventId = Number.parseInt(req.params.eventId, 10);
    if (!Number.isInteger(eventId) || eventId <= 0) throw new Error("Bad Request");

    const me = req.me;
    if (!me) throw new Error("Unauthorized");

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        organizers: { select: { id: true } },
      },
    });
    if (!event) throw new Error("Not Found");

    if (!isManager(me) && !event.organizers.some((o) => o.id === me.id)) {
      throw new Error("Forbidden");
    }

    const { type, amount, utorid, remark = "" } = req.body;
    if (type !== "event") throw new Error("Bad Request");
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("Bad Request");
    if (!utorid || typeof utorid !== "string") throw new Error("Bad Request");
    if (typeof remark !== "string" || remark.length > 255) throw new Error("Bad Request");

    const user = await prisma.user.findUnique({ where: { utorid } });
    if (!user) throw new Error("Not Found");

    const guest = await prisma.event.findFirst({
      where: { id: eventId, guests: { some: { id: user.id } } },
    });

    if (!guest) throw new Error("Bad Request");

    if (event.pointsRemain < amount) {
      throw new Error("Bad Request");
    }

    const transaction = await prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          userId: user.id,
          type: "event",
          amount,
          remark,
          eventId: eventId,
          createdById: me.id,
        },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { points: { increment: amount } },
      });

      await tx.event.update({
        where: { id: eventId },
        data: {
          pointsRemain: { decrement: amount },
          pointsAwarded: { increment: amount },
        },
      });

      return created;
    });

    return res.status(201).json({
      id: transaction.id,
      utorid: user.utorid,
      amount: transaction.amount,
      type: transaction.type,
      createdBy: me.utorid,
      remark,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
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
};
