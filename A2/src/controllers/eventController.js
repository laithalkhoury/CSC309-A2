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
        numGuests: event._count?.guests ?? event.guests?.length ?? 0,
        guests: event.guests ?? undefined,
    };
}

async function loadViewer(req) {
    const rawId =
        (req.auth && Object.prototype.hasOwnProperty.call(req.auth, "userId")
            ? req.auth.userId
            : undefined) ?? req.me?.id;

    const userId = Number(rawId);
    if (!Number.isInteger(userId) || userId <= 0) {
        return null;
    }

    const viewer = await prisma.user.findUnique({ where: { id: userId } });
    return viewer;
}

function ensureCapacity(event) {
    if (event.capacity === null || event.capacity === undefined) {
        return;
    }

    const guestCount = event._count?.guests ?? event.guests?.length ?? 0;
    if (guestCount >= event.capacity) {
        const error = new Error("Gone");
        error.statusCode = 410;
        throw error;
    }
}

const postEvent = async (req, res, next) => {
    try {
        if (!req.me) {
            return res.status(401).json({ error: "Unauthorized" });
        }
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

        const { page = 1, limit = 10, published } = req.query ?? {};
        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 10;

        if (!Number.isInteger(pageNum) || pageNum < 1) throw new Error("Bad Request");
        if (!Number.isInteger(limitNum) || limitNum < 1 || limitNum > 100)
            throw new Error("Bad Request");

        let where;
        const otherFilters = [];
        let publishedFilter = null;

        if (published !== undefined) {
            if (published === "true" || published === "1" || published === 1) {
                publishedFilter = true;
            } else if (
                published === "false" ||
                published === "0" ||
                published === 0
            ) {
                publishedFilter = false;
            } else {
                throw new Error("Bad Request");
            }
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
        if (!Number.isFinite(id) || id <= 0)
            return res.status(404).json({ error: "Not Found" });


        const viewer = await loadViewer(req);
        const role = viewer?.role ?? "regular";

        const event = await prisma.event.findUnique({
            where: { id },
            include: BASE_EVENT_INCLUDE,
        });

        if (!event) return res.status(404).json({ error: "Not Found" });

        const isOrganizer = viewer && event.organizers.some((o) => o.id === viewer.id);
        const isGuest = viewer && event.guests.some((g) => g.id === viewer.id);

        if (!event.published && !isOrganizer && !["manager", "superuser"].includes(role)) {
            return res.status(403).json({ error: "Forbidden" });
        }

        return res.status(200).json(serializeEvent(event));
    } catch (err) {
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

        const actorRole = req.me?.role ?? "regular";
        const requiresManagerRole = points !== undefined || published !== undefined;
        if (requiresManagerRole && !["manager", "superuser"].includes(actorRole)) {
            throw new Error("Forbidden");
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
            if (typeof name !== "string" || !name.trim() || name.trim().length > 100) {
                throw new Error("Bad Request");
            }
            data.name = name.trim();
        }

        if (description !== undefined) {
            if (
                typeof description !== "string" ||
                !description.trim() ||
                description.trim().length > 1000
            ) {
                throw new Error("Bad Request");
            }
            data.description = description.trim();
        }

        if (location !== undefined) {
            if (typeof location !== "string" || !location.trim() || location.trim().length > 200) {
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

        if (startTime !== undefined || endTime !== undefined) {
            const finalStart = data.startTime ?? existing.startTime;
            const finalEnd = data.endTime ?? existing.endTime;
            if (finalEnd <= finalStart) {
                throw new Error("Bad Request");
            }
        }

        if (capacity !== undefined) {
            if (capacity === null || (typeof capacity === "string" && capacity.trim().toLowerCase() === "null")) {
                data.capacity = null;
            } else {
                const parsedCapacity =
                    typeof capacity === "string" && capacity.trim() !== ""
                        ? Number(capacity)
                        : capacity;

                if (!Number.isInteger(parsedCapacity) || parsedCapacity <= 0) {
                    throw new Error("Bad Request");
                }

                if (existing.guests.length > parsedCapacity) {
                    throw new Error("Bad Request");
                }

                data.capacity = parsedCapacity;
            }
        }

        if (points !== undefined) {
            const parsedPoints =
                typeof points === "string" && points.trim() !== ""
                    ? Number(points)
                    : points;

            if (!Number.isInteger(parsedPoints) || parsedPoints <= 0) {
                throw new Error("Bad Request");
            }

            if (parsedPoints < existing.pointsAwarded) {
                throw new Error("Bad Request");
            }

            data.points = parsedPoints;
            data.pointsRemain = parsedPoints - existing.pointsAwarded;
        }

        if (published !== undefined) {
            let normalizedPublished = published;
            if (typeof published === "string") {
                const trimmed = published.trim();
                if (trimmed.toLowerCase() === "true" || trimmed === "1") {
                    normalizedPublished = true;
                } else if (trimmed.toLowerCase() === "false" || trimmed === "0") {
                    normalizedPublished = false;
                }
            } else if (typeof published === "number") {
                if (published === 1) normalizedPublished = true;
                if (published === 0) normalizedPublished = false;
            }

            if (typeof normalizedPublished !== "boolean") throw new Error("Bad Request");
            data.published = normalizedPublished;
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

        const updatedEvent = await prisma.event.update({
            where: { id: eventId },
            data: { organizers: { connect: { id: target.id } } },
            include: BASE_EVENT_INCLUDE,
        });

        return res.status(201).json(serializeEvent(updatedEvent));
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
            throw new Error("Forbidden");
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
            ensureCapacity(event);
        }

        let updatedEvent;
        if (!alreadyGuest) {
            updatedEvent = await prisma.event.update({
                where: { id: eventId },
                data: { guests: { connect: { id: target.id } } },
                include: BASE_EVENT_INCLUDE,
            });
        } else {
            updatedEvent = await prisma.event.findUnique({
                where: { id: eventId },
                include: BASE_EVENT_INCLUDE,
            });
        }
        const responseBody = serializeEvent(updatedEvent);
        responseBody.guestAdded = {
            id: target.id,
            utorid: target.utorid,
            name: target.name,
            added: !alreadyGuest,
        };

        return res.status(alreadyGuest ? 200 : 201).json(responseBody);
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

        if (event.endTime <= new Date()) {
            const error = new Error("Gone");
            error.statusCode = 410;
            throw error;
        }

        if (!event.published) return res.status(403).json({ error: "Forbidden" });

        if (event.organizers.some((o) => o.id === viewer.id)) {
            throw new Error("Bad Request");
        }

        const alreadyGuest = event.guests.some((g) => g.id === viewer.id);

        if (!alreadyGuest) {
            ensureCapacity(event);
            await prisma.event.update({
                where: { id: eventId },
                data: { guests: { connect: { id: viewer.id } } },
            });
        }

        const eventDetails = await prisma.event.findUnique({
            where: { id: eventId },
            include: BASE_EVENT_INCLUDE,
        });

        const responseBody = serializeEvent(eventDetails);
        responseBody.guestAdded = {
            id: viewer.id,
            utorid: viewer.utorid,
            name: viewer.name,
            added: !alreadyGuest,
        };

        return res.status(alreadyGuest ? 200 : 201).json(responseBody);
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

        const {
            utorids,
            utorid,
            userIds,
            userId,
            amount,
            remark = "",
        } = req.body ?? {};

        const rawIdentifiers = (() => {
            if (utorids !== undefined) return utorids;
            if (userIds !== undefined) return userIds;
            if (utorid !== undefined) return [utorid];
            if (userId !== undefined) return [userId];
            return [];
        })();

        const utoridList = Array.isArray(rawIdentifiers)
            ? rawIdentifiers
            : rawIdentifiers === undefined || rawIdentifiers === null || rawIdentifiers === ""
              ? []
              : [rawIdentifiers];

        const normalizedAmount =
            typeof amount === "string" && amount.trim() !== ""
                ? Number(amount)
                : amount;

        if (
            !Array.isArray(utoridList) ||
            !Number.isInteger(normalizedAmount) ||
            normalizedAmount <= 0
        ) {
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

        const requester = req.me || (await loadViewer(req));

        const isOrganizer = requester && event.organizers.some((o) => o.id === requester.id);
        if (!requester || (!isOrganizer && !["manager", "superuser"].includes(requester.role))) {
            throw new Error("Forbidden");
        }

        const lowerUtorids = utoridList.map((u) => String(u ?? "").trim().toLowerCase());

        const guestsByUtorid = new Map(
            event.guests.map((guest) => [guest.utorid.toLowerCase(), guest])
        );
        const guestsById = new Map(event.guests.map((guest) => [guest.id, guest]));

        let guestsToReward;

        if (lowerUtorids.length === 0) {
            guestsToReward = event.guests;
        } else {
            if (lowerUtorids.some((utorid) => !utorid)) {
                throw new Error("Bad Request");
            }

            guestsToReward = lowerUtorids.map((value) => {
                const numericId = Number.isNaN(Number(value)) ? null : Number(value);
                const guest =
                    guestsByUtorid.get(value) ||
                    (Number.isInteger(numericId) ? guestsById.get(numericId) : undefined);
                if (!guest) {
                    const error = new Error("Bad Request");
                    error.details = "missing guest";
                    throw error;
                }
                return guest;
            });
        }

        if (!guestsToReward.length) {
            throw new Error("Bad Request");
        }

        const seenGuestIds = new Set();
        guestsToReward = guestsToReward.filter((guest) => {
            if (seenGuestIds.has(guest.id)) {
                return false;
            }
            seenGuestIds.add(guest.id);
            return true;
        });

        if (event.pointsRemain < normalizedAmount * guestsToReward.length) {
            throw new Error("Bad Request");
        }

        const transactions = await prisma.$transaction(async (tx) => {
            const created = [];
            for (const guest of guestsToReward) {
                const transaction = await tx.transaction.create({
                    data: {
                        userId: guest.id,
                        type: "event",
                        amount: normalizedAmount,
                        remark: typeof remark === "string" ? remark : "",
                        eventId,
                    },
                });

                await tx.user.update({
                    where: { id: guest.id },
                    data: { points: { increment: normalizedAmount } },
                });

                created.push(transaction);
            }

            await tx.event.update({
                where: { id: eventId },
                data: {
                    pointsAwarded: { increment: normalizedAmount * guestsToReward.length },
                    pointsRemain: { decrement: normalizedAmount * guestsToReward.length },
                },
            });

            return created;
        });

        // ✅ return 200 instead of 201
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
