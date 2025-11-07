const prisma = require("../prismaClient");

function normalizeType(value) {
  if (typeof value !== "string") return null;

  const lowered = value.trim().toLowerCase();
  if (!lowered) return null;

  if (lowered === "automatic") return "automatic";

  const normalized = lowered.replace(/[-\s]+/g, "_");
  if (normalized === "one_time") return "one_time";

  return null;
}

function toResponseType(dbValue) {
  return dbValue === "one_time" ? "one_time" : dbValue;
}

function coerceNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    return Number(value);
  }
  return NaN;
}

async function loadViewer(req) {
  if (!req.auth || typeof req.auth.userId !== "number") return null;
  return prisma.user.findUnique({ where: { id: req.auth.userId } });
}

function serializePromotion(promotion) {
  return {
    id: promotion.id,
    name: promotion.name,
    description: promotion.description,
    type: toResponseType(promotion.type),
    startTime: promotion.startTime,
    endTime: promotion.endTime,
    rate: promotion.rate,
    points: promotion.points,
    minSpending: promotion.minSpending,
  };
}

const postPromotion = async (req, res, next) => {
  try {
    const {
      name,
      description,
      type,
      startTime,
      endTime,
      rate,
      points,
      minSpending,
    } = req.body ?? {};

    if (!name || !description || !type || !startTime || !endTime) {
      throw new Error("Bad Request");
    }

    if (typeof name !== "string" || name.length > 120) throw new Error("Bad Request");
    if (typeof description !== "string" || description.length > 1000)
      throw new Error("Bad Request");

    const normalizedType = normalizeType(type);
    if (!normalizedType) {
      throw new Error("Bad Request");
    }

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end <= start) {
      throw new Error("Bad Request");
    }

    const dbType = normalizedType;

    const data = {
      name,
      description,
      type: dbType,
      startTime: start,
      endTime: end,
    };

    if (minSpending !== undefined) {
      if (minSpending === null) {
        data.minSpending = null;
      } else {
        const spending = coerceNumber(minSpending);
        if (!Number.isFinite(spending) || spending < 0) throw new Error("Bad Request");
        data.minSpending = spending;
      }
    }

    if (normalizedType === "automatic") {
      const rateVal = coerceNumber(rate);
      if (!Number.isFinite(rateVal) || rateVal <= 0) throw new Error("Bad Request");
      data.rate = rateVal;
      if (points !== undefined) {
        if (points === null) {
          data.points = null;
        } else {
          const pts = coerceNumber(points);
          if (!Number.isInteger(pts) || pts < 0) throw new Error("Bad Request");
          data.points = pts;
        }
      }
    } else if (normalizedType === "one_time") {
      const ptsVal = coerceNumber(points);
      if (!Number.isInteger(ptsVal) || ptsVal <= 0) {
        throw new Error("Bad Request");
      }
      data.points = ptsVal;
      if (rate !== undefined) {
        if (rate === null) {
          data.rate = null;
        } else {
          const rateVal = coerceNumber(rate);
          if (!Number.isFinite(rateVal) || rateVal <= 0) throw new Error("Bad Request");
          data.rate = rateVal;
        }
      }
    }

    const promotion = await prisma.promotion.create({ data });

    return res.status(201).json(serializePromotion(promotion));
  } catch (err) {
    next(err);
  }
};

const getPromotions = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, started, ended, type } = req.query ?? {};

    const pageNum = Number(page);
    const limitNum = Number(limit);

    if (!Number.isInteger(pageNum) || pageNum < 1) throw new Error("Bad Request");
    if (!Number.isInteger(limitNum) || limitNum < 1 || limitNum > 100)
      throw new Error("Bad Request");

    const viewer = await loadViewer(req);
    const role = viewer?.role ?? "regular";

    const now = new Date();
    const filters = [];

    if (type !== undefined) {
      const normalizedType = normalizeType(String(type));
      if (!normalizedType) throw new Error("Bad Request");
      filters.push({ type: normalizedType });
    }

    if (started !== undefined && ended !== undefined) {
      throw new Error("Bad Request");
    }

    // Regular and cashier users can only see active promotions
    // They cannot use started/ended filters
    if (role === "regular" || role === "cashier") {
      if (started !== undefined || ended !== undefined) {
        throw new Error("Bad Request");
      }
      filters.push({ startTime: { lte: now } });
      filters.push({ endTime: { gte: now } });
    } else {
      // Managers and superusers can use started/ended filters
      if (started !== undefined) {
        if (started === "true") filters.push({ startTime: { lte: now } });
        else if (started === "false") filters.push({ startTime: { gt: now } });
        else throw new Error("Bad Request");
      }

      if (ended !== undefined) {
        if (ended === "true") filters.push({ endTime: { lt: now } });
        else if (ended === "false") filters.push({ endTime: { gte: now } });
        else throw new Error("Bad Request");
      }
    }

    const where = filters.length ? { AND: filters } : {};

    const [count, promotions] = await prisma.$transaction([
      prisma.promotion.count({ where }),
      prisma.promotion.findMany({
        where,
        orderBy: { startTime: "asc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
    ]);

    return res.status(200).json({ count, results: promotions.map(serializePromotion) });
  } catch (err) {
    next(err);
  }
};

const getPromotionById = async (req, res, next) => {
  try {
    const id = Number(req.params.promotionId);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Bad Request");

    const promotion = await prisma.promotion.findUnique({ where: { id } });
    if (!promotion) throw new Error("Not Found");

    const now = new Date();

    const viewer = await loadViewer(req);
    const role = viewer?.role ?? "regular";

    if (role === "regular" || role === "cashier") {
      if (!(promotion.startTime <= now && promotion.endTime >= now)) {
        throw new Error("Not Found");
      }
    }

    return res.status(200).json(serializePromotion(promotion));
  } catch (err) {
    next(err);
  }
};

const patchPromotionById = async (req, res, next) => {
  try {
    const id = Number(req.params.promotionId);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Bad Request");

    const promotion = await prisma.promotion.findUnique({ where: { id } });
    if (!promotion) throw new Error("Not Found");

    const { name, description, startTime, endTime, rate, points, minSpending } =
      req.body ?? {};

    if (
      name === undefined &&
      description === undefined &&
      startTime === undefined &&
      endTime === undefined &&
      rate === undefined &&
      points === undefined &&
      minSpending === undefined
    ) {
      throw new Error("Bad Request");
    }

    const now = new Date();

    if (promotion.startTime <= now) {
      if (startTime !== undefined) throw new Error("Bad Request");
      if (rate !== undefined || points !== undefined || minSpending !== undefined) {
        throw new Error("Bad Request");
      }
    }

    const data = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim() || name.length > 120) {
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

    if (rate !== undefined) {
      if (rate === null) {
        data.rate = null;
      } else {
        const rateVal = coerceNumber(rate);
        if (!Number.isFinite(rateVal) || rateVal <= 0) throw new Error("Bad Request");
        data.rate = rateVal;
      }
    }

    if (points !== undefined) {
      if (points === null) {
        data.points = null;
      } else {
        const pts = coerceNumber(points);
        if (!Number.isInteger(pts) || pts < 0) throw new Error("Bad Request");
        data.points = pts;
      }
    }

    if (minSpending !== undefined) {
      if (minSpending === null) {
        data.minSpending = null;
      } else {
        const spend = coerceNumber(minSpending);
        if (!Number.isFinite(spend) || spend < 0) throw new Error("Bad Request");
        data.minSpending = spend;
      }
    }

    const updated = await prisma.promotion.update({ where: { id }, data });

    return res.status(200).json(serializePromotion(updated));
  } catch (err) {
    next(err);
  }
};

const deletePromotionById = async (req, res, next) => {
  try {
    const id = Number(req.params.promotionId);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Bad Request");

    const promotion = await prisma.promotion.findUnique({ where: { id } });
    if (!promotion) throw new Error("Not Found");

    if (promotion.startTime <= new Date()) {
      throw new Error("Forbidden");
    }

    await prisma.promotion.delete({ where: { id } });

    return res.status(200).json({ id });
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
