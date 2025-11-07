const prisma = require("../prismaClient");

// POST /transactions - Create a new transaction
const postTransaction = async (req, res, next) => {
  try {
    const {
      utorid,
      type,
      spent,
      promotionIds: camelPromotionIds,
      promotionIDs: pascalPromotionIds,
      remark = "",
    } = req.body;

    if (!utorid || !type || spent === undefined) {
      throw new Error("Bad Request");
    }

    const utoridRegex = /^[a-zA-Z0-9]{7,8}$/;
    if (!utoridRegex.test(utorid)) {
      throw new Error("Bad Request");
    }

    const normalizedUtorid = utorid.toLowerCase();

    if (type !== "purchase") {
      throw new Error("Bad Request");
    }

    if (typeof spent !== "number" || spent < 0) {
      throw new Error("Bad Request");
    }

    const customer = await prisma.user.findUnique({ where: { utorid: normalizedUtorid } });
    if (!customer) {
      throw new Error("Bad Request");
    }

    // Validate promotions
    const promotionIDs = camelPromotionIds ?? pascalPromotionIds ?? [];

    if (!Array.isArray(promotionIDs)) {
      throw new Error("Bad Request");
    }

    let validPromotions = [];
    if (promotionIDs.length > 0) {
      validPromotions = await prisma.promotion.findMany({
        where: {
          id: {
            in: promotionIDs.map((id) => {
              const numeric = Number(id);
              if (!Number.isInteger(numeric) || numeric <= 0) {
                throw new Error("Bad Request");
              }
              return numeric;
            }),
          },
          startTime: { lte: new Date() },
          endTime: { gte: new Date() },
        },
        include: { usedByUsers: true },
      });

      if (validPromotions.length !== promotionIDs.length) {
        throw new Error("Bad Request");
      }

      for (const promo of validPromotions) {
        if (promo.type === "one_time") {
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

    const basePoints = Math.round(spent / 0.25);
    let pointsEarned = basePoints;
    for (const promo of validPromotions) {
      if (promo.points) pointsEarned += promo.points;
      if (promo.rate) pointsEarned += Math.round(basePoints * promo.rate);
    }

    const cashier = req.me;
    const suspicious = cashier?.suspicious || false;

    const transaction = await prisma.transaction.create({
      data: {
        userId: customer.id,
        type: "purchase",
        amount: pointsEarned,
        spent,
        suspicious,
        remark: remark || "",
        createdById: cashier?.id || null,
        promotions: {
          connect: validPromotions.map((p) => ({ id: p.id })),
        },
      },
      include: { promotions: { select: { id: true } } },
    });

    if (!suspicious) {
      await prisma.user.update({
        where: { id: customer.id },
        data: { points: customer.points + pointsEarned },
      });
    }

    await prisma.user.update({
      where: { id: customer.id },
      data: {
        usedPromotions: {
          connect: validPromotions.map((p) => ({ id: p.id })),
        },
      },
    });

    // POST requests that create resources should return 201
    return res.status(201).json({
      id: transaction.id,
      utorid: customer.utorid,
      type: transaction.type,
      spent: transaction.spent,
      earned: suspicious ? 0 : transaction.amount,  // No points earned if suspicious
      remark: transaction.remark,
      promotionIds: transaction.promotions.map((p) => p.id),
      createdBy: cashier?.utorid || null,
    });
  } catch (err) {
    next(err);
  }
};

// POST /transactions (adjustment)
const adjustmentTransaction = async (req, res, next) => {
  try {
    const { utorid, type, amount, relatedId, promotionIds = [], remark = "" } =
      req.body;

    if (!utorid || !type || amount === undefined || relatedId === undefined) {
      throw new Error("Bad Request");
    }

    const utoridRegex = /^[a-zA-Z0-9]{7,8}$/;
    if (!utoridRegex.test(utorid)) throw new Error("Bad Request");
    if (type !== "adjustment") throw new Error("Bad Request");
    if (typeof amount !== "number") throw new Error("Bad Request");

    const relId = Number(relatedId);
    if (isNaN(relId) || relId <= 0) throw new Error("Bad Request");

    const normalizedUtorid = utorid.toLowerCase();

    const customer = await prisma.user.findUnique({ where: { utorid: normalizedUtorid } });
    if (!customer) throw new Error("Bad Request");

    const relatedTransaction = await prisma.transaction.findUnique({
      where: { id: relId },
    });
    if (!relatedTransaction) throw new Error("Not Found");

    const manager = req.me;
    const transaction = await prisma.transaction.create({
      data: {
        userId: customer.id,
        type: "adjustment",
        amount,
        remark: remark || "",
        relatedId: relatedTransaction.id,
        createdById: manager?.id || null,
      },
      include: { promotions: { select: { id: true } } },
    });

    await prisma.user.update({
      where: { id: customer.id },
      data: { points: customer.points + amount },
    });

    return res.status(201).json({
      id: transaction.id,
      utorid: customer.utorid,
      amount: transaction.amount,
      type: transaction.type,
      relatedId: transaction.relatedId,
      remark: transaction.remark,
      promotionIds: transaction.promotions.map((p) => p.id),
      createdBy: manager?.utorid || null,
    });
  } catch (err) {
    next(err);
  }
};

const redemptionTransaction = async (req, res, next) => {
  try {
    const { utorid, type, redeemed, remark = "" } = req.body ?? {};

    if (!utorid || type !== "redemption" || redeemed === undefined) {
      throw new Error("Bad Request");
    }

    const utoridRegex = /^[a-zA-Z0-9]{7,8}$/;
    if (!utoridRegex.test(String(utorid))) throw new Error("Bad Request");

    const redeemedAmount =
      typeof redeemed === "string" && redeemed.trim() !== ""
        ? Number(redeemed)
        : redeemed;

    if (!Number.isInteger(redeemedAmount) || redeemedAmount <= 0) {
      throw new Error("Bad Request");
    }

    const normalizedUtorid = String(utorid).toLowerCase();
    const customer = await prisma.user.findUnique({
      where: { utorid: normalizedUtorid },
    });
    if (!customer) throw new Error("Bad Request");

    if (customer.points < redeemedAmount) {
      throw new Error("Bad Request");
    }

    const cashier = req.me;

    const transaction = await prisma.transaction.create({
      data: {
        userId: customer.id,
        type: "redemption",
        amount: -redeemedAmount,
        redeemed: redeemedAmount,
        remark: typeof remark === "string" ? remark : "",
        createdById: cashier?.id || null,
      },
    });

    return res.status(201).json({
      id: transaction.id,
      utorid: customer.utorid,
      type: transaction.type,
      redeemed: transaction.redeemed,
      remark: transaction.remark || "",
      createdBy: cashier?.utorid || null,
    });
  } catch (err) {
    next(err);
  }
};

const transferTransaction = async (req, res, next) => {
  try {
    const {
      type,
      amount,
      remark = "",
      fromUtorid,
      toUtorid,
      sourceUtorid,
      targetUtorid,
      from,
      to,
    } = req.body ?? {};

    if (type !== "transfer") throw new Error("Bad Request");

    const utoridRegex = /^[a-zA-Z0-9]{7,8}$/;

    const senderUtorid = fromUtorid ?? sourceUtorid ?? from;
    const receiverUtorid = toUtorid ?? targetUtorid ?? to;

    if (!senderUtorid || !receiverUtorid) throw new Error("Bad Request");
    if (!utoridRegex.test(String(senderUtorid))) throw new Error("Bad Request");
    if (!utoridRegex.test(String(receiverUtorid))) throw new Error("Bad Request");

    const normalizedSender = String(senderUtorid).toLowerCase();
    const normalizedReceiver = String(receiverUtorid).toLowerCase();

    if (normalizedSender === normalizedReceiver) {
      throw new Error("Bad Request");
    }

    const transferAmount =
      typeof amount === "string" && amount.trim() !== "" ? Number(amount) : amount;

    if (!Number.isInteger(transferAmount) || transferAmount <= 0) {
      throw new Error("Bad Request");
    }

    const [sender, receiver] = await Promise.all([
      prisma.user.findUnique({ where: { utorid: normalizedSender } }),
      prisma.user.findUnique({ where: { utorid: normalizedReceiver } }),
    ]);

    if (!sender || !receiver) throw new Error("Bad Request");

    if (sender.points < transferAmount) {
      throw new Error("Bad Request");
    }

    const cashier = req.me;
    const remarkText = typeof remark === "string" ? remark : "";

    const result = await prisma.$transaction(async (tx) => {
      const debit = await tx.transaction.create({
        data: {
          userId: sender.id,
          type: "transfer",
          amount: -transferAmount,
          remark: remarkText,
          createdById: cashier?.id || null,
        },
      });

      const credit = await tx.transaction.create({
        data: {
          userId: receiver.id,
          type: "transfer",
          amount: transferAmount,
          remark: remarkText,
          relatedId: debit.id,
          createdById: cashier?.id || null,
        },
      });

      await tx.transaction.update({
        where: { id: debit.id },
        data: { relatedId: credit.id },
      });

      await tx.user.update({
        where: { id: sender.id },
        data: { points: { decrement: transferAmount } },
      });

      await tx.user.update({
        where: { id: receiver.id },
        data: { points: { increment: transferAmount } },
      });

      return { debitId: debit.id, creditId: credit.id };
    });

    return res.status(201).json({
      id: result.debitId,
      type: "transfer",
      from: sender.utorid,
      to: receiver.utorid,
      amount: transferAmount,
      remark: remarkText,
      relatedId: result.creditId,
      createdBy: cashier?.utorid || null,
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
      page = 1,
      limit = 10,
    } = req.query;

    const pageNum = Number(page);
    const limitNum = Number(limit);
    if (isNaN(pageNum) || pageNum < 1) throw new Error("Bad Request");
    if (isNaN(limitNum) || limitNum < 1) throw new Error("Bad Request");

    const where = {};

    if (name) {
      where.user = {
        OR: [
          { name: { contains: name } },
          { utorid: { contains: name } },
        ],
      };
    }

    if (createdBy) where.createdBy = { utorid: createdBy };

    if (suspicious !== undefined)
      where.suspicious = suspicious === "true";

    if (promotionId) {
      const pid = Number(promotionId);
      if (isNaN(pid)) throw new Error("Bad Request");
      where.promotions = { some: { id: pid } };
    }

    if (type) where.type = type;

    if (relatedId) {
      const rid = Number(relatedId);
      if (isNaN(rid)) throw new Error("Bad Request");
      where.relatedId = rid;
    }

    if (amount !== undefined) {
      const amt = Number(amount);
      if (isNaN(amt) || !["gte", "lte"].includes(operator))
        throw new Error("Bad Request");
      where.amount = { [operator]: amt };
    } else if (operator) throw new Error("Bad Request");

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

    const results = transactions.map((t) => {
      const record = {
        id: t.id,
        utorid: t.user.utorid,
        amount: t.amount,
        type: t.type,
        spent: t.spent,
        promotionIds: t.promotions.map((p) => p.id),
        suspicious: t.suspicious,
        remark: t.remark || "",
        createdBy: t.createdBy?.utorid || null,
      };

      if (t.relatedId !== null) record.relatedId = t.relatedId;
      if (t.redeemed !== null) record.redeemed = t.redeemed;

      return record;
    });

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

    const response = {
      id: t.id,
      utorid: t.user.utorid,
      type: t.type,
      spent: t.spent,
      amount: t.amount,
      promotionIds: t.promotions.map((p) => p.id),
      suspicious: t.suspicious,
      remark: t.remark,
      createdBy: t.createdBy?.utorid || null,
    };

    if (t.relatedId !== null) {
      response.relatedId = t.relatedId;
    }

    return res.status(200).json(response);
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

    let transaction = await prisma.transaction.findUnique({
      where: { id: transId },
      include: { user: true, createdBy: true, promotions: true },
    });

    if (!transaction) throw new Error("Not Found");

    if (transaction.suspicious === suspicious) {
      return res.status(200).json({
        id: transaction.id,
        utorid: transaction.user.utorid,
        type: transaction.type,
        spent: transaction.spent,
        amount: transaction.amount,
        promotionIds: transaction.promotions.map((p) => p.id),
        suspicious: transaction.suspicious,
        remark: transaction.remark,
        createdBy: transaction.createdBy?.utorid || null,
      });
    }

    transaction = await prisma.transaction.update({
      where: { id: transId },
      data: { suspicious },
      include: { user: true, createdBy: true, promotions: true },
    });

    const pointAdjustment = suspicious
      ? -transaction.amount
      : transaction.amount;

    await prisma.user.update({
      where: { id: transaction.userId },
      data: {
        points: transaction.user.points + pointAdjustment,
      },
    });

    return res.status(200).json({
      id: transaction.id,
      utorid: transaction.user.utorid,
      type: transaction.type,
      spent: transaction.spent,
      amount: transaction.amount,
      promotionIds: transaction.promotions.map((p) => p.id),
      suspicious: transaction.suspicious,
      remark: transaction.remark,
      createdBy: transaction.createdBy?.utorid || null,
    });
  } catch (err) {
    next(err);
  }
};

const patchRedemptionTransactionStatusById = async (req, res, next) => {
  try {
    const id = Number(req.params.transactionId);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Bad Request");

    const { processed } = req.body ?? {};
    if (processed !== true) throw new Error("Bad Request");

    const cashier = req.me;
    if (!cashier) throw new Error("Unauthorized");

    const transaction = await prisma.transaction.findUnique({
      where: { id },
      include: {
        user: { select: { utorid: true, points: true, id: true } },
        promotions: { select: { id: true } },
        createdBy: { select: { utorid: true } }
      },
    });

    if (!transaction) throw new Error("Not Found");
    if (transaction.type !== "redemption") throw new Error("Bad Request");

    // If already processed
    if (transaction.processedBy !== null) {
      throw new Error("Bad Request");
    }

    // Deduct points and mark as processed
    const result = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: transaction.userId },
        data: { points: { increment: transaction.amount } },  // amount is negative
      });

      return tx.transaction.update({
        where: { id },
        data: { processedBy: cashier.id },
        include: {
          user: { select: { utorid: true } },
          promotions: { select: { id: true } },
          createdBy: { select: { utorid: true } }
        },
      });
    });

    // Get the processor info
    const processor = await prisma.user.findUnique({
      where: { id: result.processedBy },
      select: { utorid: true },
    });

    return res.status(200).json({
      id: result.id,
      utorid: result.user.utorid,
      type: result.type,
      processedBy: processor?.utorid || null,
      redeemed: Math.abs(result.amount),
      remark: result.remark || "",
      createdBy: result.createdBy?.utorid || null,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  postTransaction,
  adjustmentTransaction,
  redemptionTransaction,
  transferTransaction,
  getTransactions,
  getTransactionById,
  patchTransactionAsSuspiciousById,
  patchRedemptionTransactionStatusById,
};
