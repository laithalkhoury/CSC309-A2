const prisma = require("../prismaClient");

const UTORID_REGEX = /^[a-zA-Z0-9]{7,8}$/;
const VALID_TYPES = new Set([
  "purchase",
  "redemption",
  "adjustment",
  "event",
  "transfer",
]);

const formatTransaction = (transaction) => ({
  id: transaction.id,
  utorid: transaction.user.utorid,
  type: transaction.type,
  spent: transaction.spent,
  amount:
    transaction.type === "redemption"
      ? Math.abs(transaction.amount)
      : transaction.amount,
  promotionIds: transaction.promotions.map((p) => p.id),
  suspicious: transaction.suspicious,
  remark: transaction.remark || "",
  createdBy: transaction.createdBy?.utorid || null,
  relatedId: transaction.relatedId || undefined,
  processed:
    transaction.type === "redemption" ? transaction.redeemed !== null : undefined,
});

// POST /transactions - Create a new transaction
const postTransaction = async (req, res, next) => {
  try {
    const {
      utorid,
      type,
      spent,
      promotionIds: rawPromotionIds,
      promotionIDs,
      remark = "",
    } = req.body;

    if (!utorid || !type || spent === undefined) {
      throw new Error("Bad Request");
    }

    if (!UTORID_REGEX.test(utorid)) {
      throw new Error("Bad Request");
    }

    if (type !== "purchase") {
      throw new Error("Bad Request");
    }

    if (typeof spent !== "number" || Number.isNaN(spent) || spent < 0) {
      throw new Error("Bad Request");
    }

    const customer = await prisma.user.findUnique({ where: { utorid } });
    if (!customer) {
      throw new Error("Bad Request");
    }

    const promotionIds = Array.isArray(rawPromotionIds)
      ? rawPromotionIds
      : Array.isArray(promotionIDs)
      ? promotionIDs
      : [];

    if (typeof remark !== "string" || remark.length > 255) {
      throw new Error("Bad Request");
    }

    const now = new Date();

    let validPromotions = [];
    if (promotionIds.length > 0) {
      if (!promotionIds.every((id) => Number.isInteger(id) && id > 0)) {
        throw new Error("Bad Request");
      }

      validPromotions = await prisma.promotion.findMany({
        where: {
          id: { in: promotionIds },
          startTime: { lte: now },
          endTime: { gte: now },
        },
        include: { usedByUsers: true },
      });

      if (validPromotions.length !== promotionIds.length) {
        throw new Error("Bad Request");
      }

      for (const promo of validPromotions) {
        if (promo.type === "onetime") {
          const alreadyUsed = promo.usedByUsers.some(
            (u) => u.id === customer.id
          );
          if (alreadyUsed) throw new Error("Bad Request");
        }

        if (promo.minSpending && spent < promo.minSpending) {
          throw new Error("Bad Request");
        }
      }
    }

    let pointsEarned = Math.floor(spent / 0.25);
    for (const promo of validPromotions) {
      if (promo.points) pointsEarned += promo.points;
      if (promo.rate) pointsEarned += Math.floor(spent * 100 * promo.rate);
    }

    const cashier = req.me;
    const suspicious = cashier?.suspicious || false;
    const result = await prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          userId: customer.id,
          type: "purchase",
          amount: pointsEarned,
          spent,
          suspicious,
          remark,
          createdById: cashier?.id || null,
          promotions: {
            connect: validPromotions.map((p) => ({ id: p.id })),
          },
        },
        include: { promotions: { select: { id: true } } },
      });

      if (!suspicious) {
        await tx.user.update({
          where: { id: customer.id },
          data: { points: { increment: pointsEarned } },
        });
      }

      if (validPromotions.length > 0) {
        await tx.user.update({
          where: { id: customer.id },
          data: {
            usedPromotions: {
              connect: validPromotions.map((p) => ({ id: p.id })),
            },
          },
        });
      }

      return transaction;
    });

    return res.status(201).json({
      id: result.id,
      utorid: customer.utorid,
      type: result.type,
      spent: result.spent,
      earned: suspicious ? 0 : result.amount,
      remark: result.remark || "",
      promotionIds: result.promotions.map((p) => p.id),
      createdBy: cashier?.utorid || null,
      suspicious,
    });
  } catch (err) {
    next(err);
  }
};

// POST /transactions (adjustment)
const adjustmentTransaction = async (req, res, next) => {
  try {
    const { utorid, type, amount, relatedId, remark = "" } = req.body;

    if (!utorid || !type || amount === undefined || relatedId === undefined) {
      throw new Error("Bad Request");
    }

    if (!UTORID_REGEX.test(utorid)) throw new Error("Bad Request");
    if (type !== "adjustment") throw new Error("Bad Request");
    if (!Number.isInteger(amount)) throw new Error("Bad Request");

    const relId = Number(relatedId);
    if (isNaN(relId) || relId <= 0) throw new Error("Bad Request");

    const customer = await prisma.user.findUnique({ where: { utorid } });
    if (!customer) throw new Error("Bad Request");

    const relatedTransaction = await prisma.transaction.findUnique({
      where: { id: relId },
    });
    if (!relatedTransaction) throw new Error("Bad Request");
    if (relatedTransaction.userId !== customer.id) throw new Error("Bad Request");

    if (typeof remark !== "string" || remark.length > 255) {
      throw new Error("Bad Request");
    }

    const manager = req.me;
    const transaction = await prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          userId: customer.id,
          type: "adjustment",
          amount,
          remark,
          relatedId: relatedTransaction.id,
          createdById: manager?.id || null,
        },
        include: { promotions: { select: { id: true } } },
      });

      await tx.user.update({
        where: { id: customer.id },
        data: { points: { increment: amount } },
      });

      return created;
    });

    return res.status(201).json({
      id: transaction.id,
      utorid: customer.utorid,
      amount: transaction.amount,
      type: transaction.type,
      relatedId: transaction.relatedId,
      remark: transaction.remark || "",
      promotionIds: transaction.promotions.map((p) => p.id),
      createdBy: manager?.utorid || null,
    });
  } catch (err) {
    next(err);
  }
};

// GET /transactions
const getTransactions = async (req, res, next) => {
  try {
    const {
      name,
      createdBy,
      suspicious,
      promotionId,
      type,
      relatedId,
      amount,
      operator,
      processed,
      page = 1,
      limit = 10,
    } = req.query;

    const pageNum = Number.parseInt(page, 10);
    const limitNum = Number.parseInt(limit, 10);
    if (!Number.isInteger(pageNum) || pageNum < 1) throw new Error("Bad Request");
    if (!Number.isInteger(limitNum) || limitNum < 1 || limitNum > 100)
      throw new Error("Bad Request");

    const where = {};

    if (name) {
      where.user = {
        OR: [
          { name: { contains: name, mode: "insensitive" } },
          { utorid: { contains: name, mode: "insensitive" } },
        ],
      };
    }

    if (createdBy) {
      where.createdBy = { utorid: createdBy };
    }

    if (suspicious !== undefined) {
      if (suspicious !== "true" && suspicious !== "false") {
        throw new Error("Bad Request");
      }
      where.suspicious = suspicious === "true";
    }

    if (promotionId) {
      const pid = Number.parseInt(promotionId, 10);
      if (!Number.isInteger(pid) || pid <= 0) throw new Error("Bad Request");
      where.promotions = { some: { id: pid } };
    }

    if (type) {
      if (!VALID_TYPES.has(type)) throw new Error("Bad Request");
      where.type = type;
    }

    if (relatedId) {
      const rid = Number.parseInt(relatedId, 10);
      if (!Number.isInteger(rid) || rid <= 0) throw new Error("Bad Request");
      where.relatedId = rid;
    }

    if (processed !== undefined) {
      if (processed !== "true" && processed !== "false") {
        throw new Error("Bad Request");
      }
      where.redeemed = processed === "true" ? { not: null } : null;
    }

    if (amount !== undefined) {
      const amt = Number.parseInt(amount, 10);
      if (!Number.isInteger(amt)) throw new Error("Bad Request");
      if (!operator || !["gte", "lte"].includes(operator)) {
        throw new Error("Bad Request");
      }
      where.amount = { [operator]: amt };
    } else if (operator) {
      throw new Error("Bad Request");
    }

    const skip = (pageNum - 1) * limitNum;

    const count = await prisma.transaction.count({ where });
    const transactions = await prisma.transaction.findMany({
      where,
      include: {
        user: { select: { utorid: true } },
        createdBy: { select: { utorid: true } },
        promotions: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limitNum,
    });

    const results = transactions.map(formatTransaction);

    return res.status(200).json({ count, results });
  } catch (err) {
    next(err);
  }
};

// GET /transactions/:transactionId
const getTransactionById = async (req, res, next) => {
  try {
    const id = Number(req.params.transactionId);
    if (isNaN(id) || id <= 0) throw new Error("Bad Request");

    const t = await prisma.transaction.findUnique({
      where: { id },
      include: { user: true, createdBy: true, promotions: true },
    });

    if (!t) throw new Error("Not Found");

    return res.status(200).json(formatTransaction(t));
  } catch (err) {
    next(err);
  }
};

// PATCH /transactions/:transactionId/suspicious
const patchTransactionAsSuspiciousById = async (req, res, next) => {
  try {
    const transId = Number(req.params.transactionId);
    const { suspicious } = req.body;

    if (isNaN(transId) || transId <= 0 || typeof suspicious !== "boolean") {
      throw new Error("Bad Request");
    }

    const current = await prisma.transaction.findUnique({
      where: { id: transId },
      include: { user: true, createdBy: true, promotions: true },
    });

    if (!current) throw new Error("Not Found");
    if (current.type !== "purchase") throw new Error("Bad Request");

    if (current.suspicious === suspicious) {
      return res.status(200).json(formatTransaction(current));
    }

    const updated = await prisma.$transaction(async (tx) => {
      const fresh = await tx.transaction.findUnique({
        where: { id: transId },
        include: { user: true, createdBy: true, promotions: true },
      });

      if (!fresh) throw new Error("Not Found");

      const diff = suspicious ? -fresh.amount : fresh.amount;

      await tx.user.update({
        where: { id: fresh.userId },
        data: { points: { increment: diff } },
      });

      return tx.transaction.update({
        where: { id: transId },
        data: { suspicious },
        include: { user: true, createdBy: true, promotions: true },
      });
    });

    return res.status(200).json(formatTransaction(updated));
  } catch (err) {
    next(err);
  }
};

const patchRedemptionTransactionStatusById = async (req, res, next) => {
  try {
    const transactionId = Number.parseInt(req.params.transactionId, 10);
    const { processed } = req.body;

    if (!Number.isInteger(transactionId) || transactionId <= 0)
      throw new Error("Bad Request");
    if (typeof processed !== "boolean") throw new Error("Bad Request");

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { user: true, createdBy: true, promotions: true },
    });

    if (!transaction) throw new Error("Not Found");
    if (transaction.type !== "redemption") throw new Error("Bad Request");

    if (processed && transaction.redeemed !== null) {
      return res.status(200).json(formatTransaction(transaction));
    }

    if (!processed && transaction.redeemed === null) {
      return res.status(200).json(formatTransaction(transaction));
    }

    const amount = Math.abs(transaction.amount);

    if (processed) {
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: transaction.userId },
          select: { points: true },
        });

        if (!user || user.points < amount) {
          throw new Error("Bad Request");
        }

        await tx.user.update({
          where: { id: transaction.userId },
          data: { points: { decrement: amount } },
        });

        await tx.transaction.update({
          where: { id: transactionId },
          data: { redeemed: amount },
        });
      });
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: transaction.userId },
          data: { points: { increment: amount } },
        });

        await tx.transaction.update({
          where: { id: transactionId },
          data: { redeemed: null },
        });
      });
    }

    const updated = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { user: true, createdBy: true, promotions: true },
    });

    return res.status(200).json(formatTransaction(updated));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  postTransaction,
  adjustmentTransaction,
  getTransactions,
  getTransactionById,
  patchTransactionAsSuspiciousById,
  patchRedemptionTransactionStatusById
};
