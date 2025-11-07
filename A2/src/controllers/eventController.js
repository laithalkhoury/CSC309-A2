const prisma = require("../prismaClient");

const BASE_EVENT_INCLUDE = {
  organizers: {
    select: { id: true, utorid: true, name: true },
    orderBy: { id: "asc" },
  },
  guests: {
    select: { id: true, utorid: true, name: true },
    orderBy: { id: "asc" },
  },
  createdBy: { select: { id: true, utorid: true, name: true } },
  _count: { select: { guests: true, organizers: true } },
};

function serializeEvent(event) {
  return {
    id: event.id,
    name: event.name,
    description: event.description,
    location: event.location,
    startTime: event.startTime,
    endTime: event.endTime,
    capacity: event.capacity,
    points: event.points,
    pointsRemain: event.pointsRemain,
    pointsAwarded: event.pointsAwarded,
    published: event.published,
    createdBy: event.createdBy
      ? {
          id: event.createdBy.id,
          utorid: event.createdBy.utorid,
          name: event.createdBy.name,
        }
      : null,
    organizers: event.organizers ?? [],
    guestCount: event._count?.guests ?? event.guests?.length ?? 0,
    guests: event.guests ?? undefined,
  };
}

async function loadViewer(req) {
  if (!req.auth || typeof req.auth.userId !== "number") return null;
  const viewer = await prisma.user.findUnique({ where: { id: req.auth.userId } });
  return viewer;
}

function ensureCapacity(event) {
  if (event.capacity !== null && event._count.guests >= event.capacity) {
    throw new Error("Bad Request");
  }
}

const postEvent = async (req, res, next) => {
  try {
    const { name, description, location, startTime, endTime, capacity, points } =
      req.body ?? {};

    if (!name || !description || !location || !startTime || !endTime) {
      throw new Error("Bad Request");
    }

    if (
      typeof name !== "string" ||
      typeof description !== "string" ||
      typeof location !== "string"
    ) {
      throw new Error("Bad Request");
    }

    if (name.length > 100 || description.length > 1000 || location.length > 200) {
      throw new Error("Bad Request");
    }

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) {
      throw new Error("Bad Request");
    }

    if (end <= start) {
      throw new Error("Bad Request");
    }

    let capacityValue = null;
    if (capacity !== undefined && capacity !== null) {
      if (!Number.isInteger(capacity) || capacity <= 0) {
        throw new Error("Bad Request");
      }
      capacityValue = capacity;
    }

    if (!Number.isInteger(points) || points <= 0) {
      throw new Error("Bad Request");
    }

    const creator = req.me;

    const event = await prisma.event.create({
      data: {
        name,
        description,
        location,
        startTime: start,
        endTime: end,
        capacity: capacityValue,
        points,
        pointsRemain: points,
        createdById: creator?.id ?? null,
        organizers: creator
          ? {
              connect: { id: creator.id },
            }
          : undefined,
      },
      include: BASE_EVENT_INCLUDE,
    });

    return res.status(201).json(serializeEvent(event));
  } catch (err) {
    if (err.statusCode === 410) {
      return res.status(410).json({ error: "Gone" });
    }
    next(err);
  }
};

const getEvents = async (req, res, next) => {
  try {
    const viewer = await loadViewer(req);
    const role = viewer?.role ?? "regular";

    const { page = 1, limit = 20, published } = req.query ?? {};

    const pageNum = Number(page);
    const limitNum = Number(limit);

    if (!Number.isInteger(pageNum) || pageNum < 1) throw new Error("Bad Request");
    if (!Number.isInteger(limitNum) || limitNum < 1 || limitNum > 100)
      throw new Error("Bad Request");

    let where;
    const otherFilters = [];
    let publishedFilter = null;

    if (published !== undefined) {
      if (published === "true") publishedFilter = true;
      else if (published === "false") publishedFilter = false;
      else throw new Error("Bad Request");
    }

    if (role === "manager" || role === "superuser") {
      const conditions = [...otherFilters];
      if (publishedFilter !== null) {
        conditions.push({ published: publishedFilter });
      }
      where = conditions.length ? { AND: conditions } : {};
    } else {
      const clauses = [];

      if (publishedFilter !== false) {
        const publishedConditions = [...otherFilters];
        if (publishedFilter === true) {
          publishedConditions.push({ published: true });
        }
        clauses.push({ AND: [...publishedConditions, { published: true }] });
      }

      if (viewer && publishedFilter !== true) {
        const membershipFilters = [...otherFilters];
        if (publishedFilter !== null) {
          membershipFilters.push({ published: publishedFilter });
        }
        clauses.push({
          AND: [...membershipFilters, { organizers: { some: { id: viewer.id } } }],
        });
        clauses.push({
          AND: [...membershipFilters, { guests: { some: { id: viewer.id } } }],
        });
      }

      if (clauses.length === 0) {
        where = { id: -1 };
      } else {
        where = { OR: clauses };
      }
    }

    const [count, events] = await prisma.$transaction([
      prisma.event.count({ where }),
      prisma.event.findMany({
        where,
        orderBy: { startTime: "asc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        include: {
          createdBy: { select: { id: true, utorid: true, name: true } },
          organizers: {
            select: { id: true, utorid: true, name: true },
            orderBy: { id: "asc" },
          },
          _count: { select: { guests: true } },
        },
      }),
    ]);

    const results = events.map((event) => serializeEvent(event));
    return res.status(200).json({ count, results });
  } catch (err) {
    next(err);
  }
};

const getEventById = async (req, res, next) => {
  try {
    const id = Number(req.params.eventId);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Bad Request");

    const viewer = await loadViewer(req);
    const role = viewer?.role ?? "regular";

    const event = await prisma.event.findUnique({
      where: { id },
      include: BASE_EVENT_INCLUDE,
    });

    if (!event) throw new Error("Not Found");

    const isOrganizer = viewer && event.organizers.some((o) => o.id === viewer.id);
    const isGuest = viewer && event.guests.some((g) => g.id === viewer.id);

    if (!event.published && !isOrganizer && !["manager", "superuser"].includes(role)) {
      throw new Error("Forbidden");
    }

    if (event.published === false && role === "regular" && !isOrganizer && !isGuest) {
      throw new Error("Forbidden");
    }

    return res.status(200).json(serializeEvent(event));
  } catch (err) {
    if (err.statusCode === 410) {
      return res.status(410).json({ error: "Gone" });
    }
    next(err);
  }
};

const patchEventById = async (req, res, next) => {
  try {
    const id = Number(req.params.eventId);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Bad Request");

    const {
      name,
      description,
      location,
      startTime,
      endTime,
      capacity,
      points,
      published,
    } = req.body ?? {};

    if (
      name === undefined &&
      description === undefined &&
      location === undefined &&
      startTime === undefined &&
      endTime === undefined &&
      capacity === undefined &&
      points === undefined &&
      published === undefined
    ) {
      throw new Error("Bad Request");
    }

    const existing = await prisma.event.findUnique({
      where: { id },
      include: {
        organizers: { select: { id: true } },
        guests: { select: { id: true } },
      },
    });

    if (!existing) throw new Error("Not Found");

    const now = new Date();
    if (existing.endTime <= now) {
      if (name !== undefined || description !== undefined || location !== undefined) {
        throw new Error("Bad Request");
      }
    }

    const data = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim() || name.length > 100) {
        throw new Error("Bad Request");
      }
      data.name = name.trim();
    }

    if (description !== undefined) {
      if (typeof description !== "string" || !description.trim() || description.length > 1000) {
        throw new Error("Bad Request");
      }
      data.description = description.trim();
    }

    if (location !== undefined) {
      if (typeof location !== "string" || !location.trim() || location.length > 200) {
        throw new Error("Bad Request");
      }
      data.location = location.trim();
    }

    if (startTime !== undefined) {
      const start = new Date(startTime);
      if (Number.isNaN(start.valueOf())) throw new Error("Bad Request");
      data.startTime = start;
    }

    if (endTime !== undefined) {
      const end = new Date(endTime);
      if (Number.isNaN(end.valueOf())) throw new Error("Bad Request");
      data.endTime = end;
    }

    if (data.startTime && data.endTime && data.endTime <= data.startTime) {
      throw new Error("Bad Request");
    }

    if (capacity !== undefined) {
      if (capacity === null) {
        data.capacity = null;
      } else if (!Number.isInteger(capacity) || capacity <= 0) {
        throw new Error("Bad Request");
      } else if (existing.guests.length > capacity) {
        throw new Error("Bad Request");
      } else {
        data.capacity = capacity;
      }
    }

    if (points !== undefined) {
      if (!Number.isInteger(points) || points < existing.pointsAwarded) {
        throw new Error("Bad Request");
      }
      data.points = points;
      data.pointsRemain = points - existing.pointsAwarded;
    }

    if (published !== undefined) {
      if (typeof published !== "boolean") throw new Error("Bad Request");
      if (published && existing.organizers.length === 0) {
        throw new Error("Bad Request");
      }
      data.published = published;
    }

    const updated = await prisma.event.update({
      where: { id },
      data,
      include: BASE_EVENT_INCLUDE,
    });

    return res.status(200).json(serializeEvent(updated));
  } catch (err) {
    if (err.statusCode === 410) {
      return res.status(410).json({ error: "Gone" });
    }
    next(err);
  }
};

const deleteEventById = async (req, res, next) => {
  try {
    const id = Number(req.params.eventId);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Bad Request");

    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) throw new Error("Not Found");

    if (event.published) {
      throw new Error("Bad Request");
    }

    if (event.startTime <= new Date()) {
      throw new Error("Bad Request");
    }

    await prisma.event.delete({ where: { id } });

    return res.status(200).json({ id });
  } catch (err) {
    next(err);
  }
};

const postOrganizerToEvent = async (req, res, next) => {
  try {
    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId) || eventId <= 0) throw new Error("Bad Request");

    const { utorid, userId } = req.body ?? {};

    if (!utorid && !userId) throw new Error("Bad Request");

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        organizers: { select: { id: true } },
        guests: { select: { id: true } },
      },
    });
    if (!event) throw new Error("Not Found");

    if (event.endTime <= new Date()) {
      const error = new Error("Gone");
      error.statusCode = 410;
      throw error;
    }

    const target = await prisma.user.findFirst({
      where: utorid
        ? { utorid: String(utorid).toLowerCase() }
        : { id: Number(userId) },
      select: { id: true, utorid: true, name: true },
    });

    if (!target) throw new Error("Not Found");

    if (event.organizers.some((o) => o.id === target.id)) {
      throw new Error("Conflict");
    }

    if (event.guests.some((g) => g.id === target.id)) {
      throw new Error("Bad Request");
    }

    await prisma.event.update({
      where: { id: eventId },
      data: { organizers: { connect: { id: target.id } } },
    });

    return res.status(201).json({ id: target.id, utorid: target.utorid, name: target.name });
  } catch (err) {
    if (err.statusCode === 410) {
      return res.status(410).json({ error: "Gone" });
    }
    next(err);
  }
};

const removeOrganizerFromEvent = async (req, res, next) => {
  try {
    const eventId = Number(req.params.eventId);
    const userId = Number(req.params.userId);

    if (!Number.isInteger(eventId) || eventId <= 0) throw new Error("Bad Request");
    if (!Number.isInteger(userId) || userId <= 0) throw new Error("Bad Request");

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        organizers: { select: { id: true } },
      },
    });

    if (!event) throw new Error("Not Found");

    if (event.endTime <= new Date()) {
      const error = new Error("Gone");
      error.statusCode = 410;
      throw error;
    }

    if (!event.organizers.some((o) => o.id === userId)) {
      throw new Error("Not Found");
    }

    if (event.organizers.length <= 1) {
      throw new Error("Bad Request");
    }

    await prisma.event.update({
      where: { id: eventId },
      data: { organizers: { disconnect: { id: userId } } },
    });

    return res.status(200).json({ id: userId });
  } catch (err) {
    if (err.statusCode === 410) {
      return res.status(410).json({ error: "Gone" });
    }
    next(err);
  }
};

const postGuestToEvent = async (req, res, next) => {
  try {
    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId) || eventId <= 0) throw new Error("Bad Request");

    const { utorid, userId } = req.body ?? {};
    if (!utorid && !userId) throw new Error("Bad Request");

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        organizers: { select: { id: true } },
        guests: { select: { id: true } },
        _count: { select: { guests: true } },
      },
    });

    if (!event) throw new Error("Not Found");

    if (event.endTime <= new Date()) {
      const error = new Error("Gone");
      error.statusCode = 410;
      throw error;
    }

    ensureCapacity(event);

    const target = await prisma.user.findFirst({
      where: utorid
        ? { utorid: String(utorid).toLowerCase() }
        : { id: Number(userId) },
      select: { id: true, utorid: true, name: true },
    });

    if (!target) throw new Error("Not Found");

    if (event.organizers.some((o) => o.id === target.id)) {
      throw new Error("Bad Request");
    }

    const alreadyGuest = event.guests.some((g) => g.id === target.id);

    if (!alreadyGuest) {
      await prisma.event.update({
        where: { id: eventId },
        data: { guests: { connect: { id: target.id } } },
      });
    }

    return res
      .status(alreadyGuest ? 200 : 201)
      .json({ id: target.id, utorid: target.utorid, name: target.name });
  } catch (err) {
    if (err.statusCode === 410) {
      return res.status(410).json({ error: "Gone" });
    }
    next(err);
  }
};

const deleteGuestFromEvent = async (req, res, next) => {
  try {
    const eventId = Number(req.params.eventId);
    const userId = Number(req.params.userId);

    if (!Number.isInteger(eventId) || eventId <= 0) throw new Error("Bad Request");
    if (!Number.isInteger(userId) || userId <= 0) throw new Error("Bad Request");

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { guests: { select: { id: true } } },
    });

    if (!event) throw new Error("Not Found");

    if (event.endTime <= new Date()) {
      const error = new Error("Gone");
      error.statusCode = 410;
      throw error;
    }

    if (!event.guests.some((g) => g.id === userId)) {
      throw new Error("Not Found");
    }

    await prisma.event.update({
      where: { id: eventId },
      data: { guests: { disconnect: { id: userId } } },
    });

    return res.status(200).json({ id: userId });
  } catch (err) {
    if (err.statusCode === 410) {
      return res.status(410).json({ error: "Gone" });
    }
    next(err);
  }
};

const postCurrentUserToEvent = async (req, res, next) => {
  try {
    const viewer = await loadViewer(req);
    if (!viewer) throw new Error("Unauthorized");

    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId) || eventId <= 0) throw new Error("Bad Request");

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        organizers: { select: { id: true } },
        guests: { select: { id: true } },
        _count: { select: { guests: true } },
      },
    });

    if (!event) throw new Error("Not Found");

    if (!event.published) throw new Error("Forbidden");

    if (event.endTime <= new Date()) {
      const error = new Error("Gone");
      error.statusCode = 410;
      throw error;
    }

    if (event.organizers.some((o) => o.id === viewer.id)) {
      throw new Error("Bad Request");
    }

    ensureCapacity(event);

    const alreadyGuest = event.guests.some((g) => g.id === viewer.id);

    if (!alreadyGuest) {
      await prisma.event.update({
        where: { id: eventId },
        data: { guests: { connect: { id: viewer.id } } },
      });
    }

    return res.status(alreadyGuest ? 200 : 201).json({
      id: viewer.id,
      utorid: viewer.utorid,
      name: viewer.name,
    });
  } catch (err) {
    if (err.statusCode === 410) {
      return res.status(410).json({ error: "Gone" });
    }
    next(err);
  }
};

const removeCurrentUserFromEvent = async (req, res, next) => {
  try {
    const viewer = await loadViewer(req);
    if (!viewer) throw new Error("Unauthorized");

    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId) || eventId <= 0) throw new Error("Bad Request");

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        guests: { select: { id: true } },
      },
    });

    if (!event) throw new Error("Not Found");

    if (event.endTime <= new Date()) {
      const error = new Error("Gone");
      error.statusCode = 410;
      throw error;
    }

    if (!event.guests.some((g) => g.id === viewer.id)) {
      throw new Error("Not Found");
    }

    await prisma.event.update({
      where: { id: eventId },
      data: { guests: { disconnect: { id: viewer.id } } },
    });

    return res.status(204).send();
  } catch (err) {
    if (err.statusCode === 410) {
      return res.status(410).json({ error: "Gone" });
    }
    next(err);
  }
};

const createRewardTransaction = async (req, res, next) => {
  try {
    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId) || eventId <= 0) throw new Error("Bad Request");

    const { utorids = [], amount, remark = "" } = req.body ?? {};

    if (!Array.isArray(utorids) || !Number.isInteger(amount) || amount <= 0) {
      throw new Error("Bad Request");
    }

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        organizers: { select: { id: true } },
        guests: { select: { id: true, utorid: true, name: true } },
      },
    });

    if (!event) throw new Error("Not Found");

    if (event.endTime > new Date()) {
      throw new Error("Bad Request");
    }

    const requester = await loadViewer(req);
    const isOrganizer = requester && event.organizers.some((o) => o.id === requester.id);
    if (!requester || (!isOrganizer && !["manager", "superuser"].includes(requester.role))) {
      throw new Error("Forbidden");
    }

    const lowerUtorids = utorids.map((u) => String(u).toLowerCase());

    const guestsByUtorid = new Map(
      event.guests.map((guest) => [guest.utorid.toLowerCase(), guest])
    );

    const guestsToReward = lowerUtorids.map((utorid) => {
      const guest = guestsByUtorid.get(utorid);
      if (!guest) {
        const error = new Error("Bad Request");
        error.details = "missing guest";
        throw error;
      }
      return guest;
    });

    if (event.pointsRemain < amount * guestsToReward.length) {
      throw new Error("Bad Request");
    }

    const transactions = await prisma.$transaction(async (tx) => {
      const created = [];
      for (const guest of guestsToReward) {
        const transaction = await tx.transaction.create({
          data: {
            userId: guest.id,
            type: "event",
            amount,
            remark: typeof remark === "string" ? remark : "",
            eventId,
          },
        });

        await tx.user.update({
          where: { id: guest.id },
          data: { points: { increment: amount } },
        });

        created.push(transaction);
      }

      await tx.event.update({
        where: { id: eventId },
        data: {
          pointsAwarded: { increment: amount * guestsToReward.length },
          pointsRemain: { decrement: amount * guestsToReward.length },
        },
      });

      return created;
    });

    return res.status(200).json({
      count: transactions.length,
      results: transactions.map((t) => ({
        id: t.id,
        userId: t.userId,
        amount: t.amount,
        type: t.type,
        eventId: t.eventId,
      })),
    });
  } catch (err) {
    if (err.details === "missing guest") {
      return res.status(400).json({ error: "Bad Request" });
    }
    if (err.statusCode === 410) {
      return res.status(410).json({ error: "Gone" });
    }
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
