const prisma = require("../prismaClient");

const PROMOTION_TYPES = new Set(["automatic", "one-time"]);

const toDbType = (type) => (type === "one-time" ? "onetime" : type);
const fromDbType = (type) => (type === "onetime" ? "one-time" : type);

const parseDate = (value) => {
  const date = new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error("Bad Request");
  }
  return date;
};

const validatePromotionPayload = (payload, { partial = false } = {}) => {
  const {
    name,
    description,
    type,
    startTime,
    endTime,
    minSpending,
    rate,
    points,
  } = payload;

  if (!partial) {
    if (!name || !description || !type || !startTime || !endTime) {
      throw new Error("Bad Request");
    }
  }

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0 || name.length > 100) {
      throw new Error("Bad Request");
    }
  }

  if (description !== undefined) {
    if (
      typeof description !== "string" ||
      description.trim().length === 0 ||
      description.length > 1000
    ) {
      throw new Error("Bad Request");
    }
  }

  if (type !== undefined) {
    if (typeof type !== "string" || !PROMOTION_TYPES.has(type)) {
      throw new Error("Bad Request");
    }
  }

  if (minSpending !== undefined) {
    if (typeof minSpending !== "number" || Number.isNaN(minSpending) || minSpending < 0) {
      throw new Error("Bad Request");
    }
  }

  if (rate !== undefined) {
    if (typeof rate !== "number" || Number.isNaN(rate) || rate <= 0) {
      throw new Error("Bad Request");
    }
  }

  if (points !== undefined) {
    if (!Number.isInteger(points) || points < 0) {
      throw new Error("Bad Request");
    }
  }

  let start = undefined;
  let end = undefined;

  if (startTime !== undefined) {
    start = parseDate(startTime);
  }

  if (endTime !== undefined) {
    end = parseDate(endTime);
  }

  if (start && end && end <= start) {
    throw new Error("Bad Request");
  }

  if (!partial) {
    if (rate === undefined && points === undefined) {
      throw new Error("Bad Request");
    }
  }

  return { start, end };
};

const toPromotionResponse = (promotion) => ({
  id: promotion.id,
  name: promotion.name,
  description: promotion.description,
  type: fromDbType(promotion.type),
  startTime: promotion.startTime.toISOString(),
  endTime: promotion.endTime.toISOString(),
  minSpending: promotion.minSpending,
  rate: promotion.rate,
  points: promotion.points,
});

const postPromotion = async (req, res, next) => {
  try {
    const { start, end } = validatePromotionPayload(req.body);

    const promotion = await prisma.promotion.create({
      data: {
        name: req.body.name.trim(),
        description: req.body.description.trim(),
        type: toDbType(req.body.type),
        startTime: start,
        endTime: end,
        minSpending: req.body.minSpending ?? null,
        rate: req.body.rate ?? null,
        points: req.body.points ?? null,
      },
    });

    return res.status(201).json(toPromotionResponse(promotion));
  } catch (err) {
    next(err);
  }
};

const getPromotions = async (req, res, next) => {
  try {
    const me = req.me;
    if (!me) throw new Error("Unauthorized");

    const { started, ended, page = 1, limit = 20 } = req.query;

    if (started !== undefined && ended !== undefined) {
      throw new Error("Bad Request");
    }

    const pageNum = Number.parseInt(page, 10);
    const limitNum = Number.parseInt(limit, 10);
    if (!Number.isInteger(pageNum) || pageNum <= 0) throw new Error("Bad Request");
    if (!Number.isInteger(limitNum) || limitNum <= 0 || limitNum > 100) {
      throw new Error("Bad Request");
    }

    const now = new Date();
    const where = {};

    if (me.role === "manager" || me.role === "superuser") {
      if (started !== undefined) {
        if (started !== "true" && started !== "false") throw new Error("Bad Request");
        where.startTime = started === "true" ? { lte: now } : { gt: now };
      }

      if (ended !== undefined) {
        if (ended !== "true" && ended !== "false") throw new Error("Bad Request");
        where.endTime = ended === "true" ? { lt: now } : { gte: now };
      }
    } else {
      where.startTime = { lte: now };
      where.endTime = { gte: now };
      where.OR = [
        { type: "automatic" },
        {
          type: "onetime",
          usedByUsers: {
            none: { id: me.id },
          },
        },
      ];
    }

    const [count, promotions] = await Promise.all([
      prisma.promotion.count({ where }),
      prisma.promotion.findMany({
        where,
        orderBy: { startTime: "asc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
    ]);

    const results = promotions.map(toPromotionResponse);
    return res.status(200).json({ count, results });
  } catch (err) {
    next(err);
  }
};

const getPromotionById = async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.promotionId, 10);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Bad Request");

    const me = req.me;
    if (!me) throw new Error("Unauthorized");

    const promotion = await prisma.promotion.findUnique({ where: { id } });
    if (!promotion) throw new Error("Not Found");

    const now = new Date();
    const isActive = promotion.startTime <= now && promotion.endTime >= now;

    if (me.role === "regular" || me.role === "cashier") {
      if (!isActive) throw new Error("Not Found");
      if (
        promotion.type === "onetime" &&
        (await prisma.promotion.count({
          where: {
            id,
            usedByUsers: { some: { id: me.id } },
          },
        }))
      ) {
        throw new Error("Not Found");
      }
    }

    return res.status(200).json(toPromotionResponse(promotion));
  } catch (err) {
    next(err);
  }
};

const patchPromotionById = async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.promotionId, 10);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Bad Request");

    if (Object.keys(req.body).length === 0) throw new Error("Bad Request");

    const promotion = await prisma.promotion.findUnique({ where: { id } });
    if (!promotion) throw new Error("Not Found");

    const now = new Date();
    if (promotion.startTime <= now || promotion.endTime <= now) {
      throw new Error("Bad Request");
    }

    const { start, end } = validatePromotionPayload(req.body, { partial: true });

    const data = {};
    if (req.body.name !== undefined) data.name = req.body.name.trim();
    if (req.body.description !== undefined)
      data.description = req.body.description.trim();
    if (req.body.type !== undefined) data.type = toDbType(req.body.type);
    if (start) data.startTime = start;
    if (end) data.endTime = end;
    if (req.body.minSpending !== undefined) data.minSpending = req.body.minSpending;
    if (req.body.rate !== undefined) data.rate = req.body.rate;
    if (req.body.points !== undefined) data.points = req.body.points;

    const updated = await prisma.promotion.update({ where: { id }, data });

    return res.status(200).json(toPromotionResponse(updated));
  } catch (err) {
    next(err);
  }
};

const deletePromotionById = async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.promotionId, 10);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Bad Request");

    const promotion = await prisma.promotion.findUnique({ where: { id } });
    if (!promotion) throw new Error("Not Found");

    const now = new Date();
    if (promotion.startTime <= now) {
      throw new Error("Forbidden");
    }

    await prisma.promotion.delete({ where: { id } });
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  postPromotion,
  getPromotions,
  getPromotionById,
  patchPromotionById,
  deletePromotionById,
};
