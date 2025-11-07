const { v4: uuidv4 } = require("uuid");
const prisma = require("../prismaClient");
const { hashPassword, comparePassword } = require("../services/bcrypt");


// POST /users - Register a new user
const postUser = async (req, res, next) => {
  try {
    const { utorid, name, email } = req.body;

    if (!utorid || !name || !email) throw new Error("Bad Request");

    const utoridRegex = /^[a-zA-Z0-9]{7,8}$/;
    if (!utoridRegex.test(utorid)) throw new Error("Bad Request");

    if (typeof name !== "string" || name.trim().length === 0 || name.length > 50)
      throw new Error("Bad Request");

    const emailRegex = /^[A-Za-z0-9._%+-]+@(mail\.)?utoronto\.ca$/;
    if (!emailRegex.test(email)) throw new Error("Bad Request");

    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ utorid }, { email }],
      },
    });
    if (existing) throw new Error("Conflict");

    const resetToken = uuidv4();
    const resetExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const temporaryPassword = await hashPassword(uuidv4());

    const user = await prisma.user.create({
      data: {
        utorid,
        name: name.trim(),
        email,
        verified: false,
        resetToken,
        resetExpiresAt,
        password: temporaryPassword,
      },
      select: {
        id: true,
        utorid: true,
        name: true,
        email: true,
        verified: true,
        resetToken: true,
        resetExpiresAt: true,
      },
    });

    return res.status(201).json({
      id: user.id,
      utorid: user.utorid,
      name: user.name,
      email: user.email,
      verified: user.verified,
      resetToken: user.resetToken,
      expiresAt: user.resetExpiresAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
};


// GET /users - Retrieve a list of users (manager or higher)
const getUsers = async (req, res, next) => {
  try {
    const { name, role, verified, activated, page = 1, limit = 10 } = req.query;

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 10, 1), 100);

    const where = {};

    if (name) {
      where.OR = [
        { utorid: { contains: String(name), mode: "insensitive" } },
        { name: { contains: String(name), mode: "insensitive" } },
      ];
    }

    if (role) where.role = String(role);

    if (verified !== undefined) {
      if (verified === "true") where.verified = true;
      else if (verified === "false") where.verified = false;
    }

    if (activated !== undefined) {
      if (activated === "true") where.lastLogin = { not: null };
      else if (activated === "false") where.lastLogin = null;
    }

    const count = await prisma.user.count({ where });

    const results = await prisma.user.findMany({
      where,
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      orderBy: { id: "asc" },
      select: {
        id: true,
        utorid: true,
        name: true,
        email: true,
        birthday: true,
        role: true,
        points: true,
        createdAt: true,
        lastLogin: true,
        verified: true,
        avatarUrl: true,
      },
    });

    return res.status(200).json({ count, results });
  } catch (err) {
    next(err);
  }
};


// GET /users/me - Get current authenticated user
const getCurrentUser = async (req, res, next) => {
  try {
    const me = req.me;
    if (!me) throw new Error("Unauthorized");

    const user = await prisma.user.findUnique({
      where: { id: me.id },
      select: {
        id: true,
        utorid: true,
        name: true,
        email: true,
        birthday: true,
        role: true,
        points: true,
        createdAt: true,
        lastLogin: true,
        verified: true,
        avatarUrl: true,
      },
    });
    if (!user) throw new Error("Not Found");

    const now = new Date();
    const promotions = await prisma.promotion.findMany({
      where: {
        type: "onetime",
        startTime: { lte: now },
        endTime: { gte: now },
        usedByUsers: { none: { id: me.id } },
      },
      select: {
        id: true,
        name: true,
        minSpending: true,
        rate: true,
        points: true,
      },
      orderBy: { id: "asc" },
    });

    return res.status(200).json({ ...user, promotions });
  } catch (err) {
    next(err);
  }
};


// GET /users/:userId
const getUserById = async (req, res, next) => {
  try {
    const id = Number(req.params.userId);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Bad Request");

    const meRole = req.me?.role;
    if (!meRole) throw new Error("Unauthorized");

    const isManagerOrHigher = meRole === "manager" || meRole === "superuser";

    const selectFields = isManagerOrHigher
      ? {
          id: true,
          utorid: true,
          name: true,
          email: true,
          birthday: true,
          role: true,
          points: true,
          createdAt: true,
          lastLogin: true,
          verified: true,
          avatarUrl: true,
        }
      : {
          id: true,
          utorid: true,
          name: true,
          points: true,
          verified: true,
        };

    const user = await prisma.user.findUnique({
      where: { id },
      select: selectFields,
    });
    if (!user) throw new Error("Not Found");

    const now = new Date();
    const promotions = await prisma.promotion.findMany({
      where: {
        type: "onetime",
        startTime: { lte: now },
        endTime: { gte: now },
        usedByUsers: { none: { id } },
      },
      select: {
        id: true,
        name: true,
        minSpending: true,
        rate: true,
        points: true,
      },
      orderBy: { id: "asc" },
    });

    return res.status(200).json({ ...user, promotions });
  } catch (err) {
    next(err);
  }
};


// PATCH /users/:userId
const patchUserById = async (req, res, next) => {
  try {
    const id = Number(req.params.userId);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Bad Request");

    const { email, verified, suspicious, role } = req.body;

    if (
      email === undefined &&
      verified === undefined &&
      suspicious === undefined &&
      role === undefined
    ) throw new Error("Bad Request");

    const meRole = req.me?.role;
    if (!meRole) throw new Error("Unauthorized");

    if (role !== undefined) {
      if (!["regular", "cashier", "manager", "superuser"].includes(role))
        throw new Error("Bad Request");

      if (meRole === "manager" && !["regular", "cashier"].includes(role))
        throw new Error("Forbidden");
    }

    if (email !== undefined) {
      const emailOk = typeof email === "string" &&
        /^[A-Za-z0-9._%+-]+@(mail\.)?utoronto\.ca$/.test(email);
      if (!emailOk) throw new Error("Bad Request");
    }

    if (verified !== undefined && verified !== true) throw new Error("Bad Request");

    if (suspicious !== undefined && typeof suspicious !== "boolean")
      throw new Error("Bad Request");

    const current = await prisma.user.findUnique({
      where: { id },
      select: { id: true, utorid: true, name: true, suspicious: true, role: true }
    });
    if (!current) throw new Error("Not Found");

    const data = {};
    const response = { id: current.id, utorid: current.utorid, name: current.name };

    if (email !== undefined) data.email = email;
    if (verified !== undefined) data.verified = true;
    if (suspicious !== undefined) data.suspicious = suspicious;
    if (role !== undefined) data.role = role;

    if (role === "cashier") {
      if (suspicious === true) throw new Error("Bad Request");
      if (current.suspicious === true && suspicious === undefined) {
        data.suspicious = false;
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        utorid: true,
        name: true,
        email: true,
        verified: true,
        suspicious: true,
        role: true,
      },
    });

    if (email !== undefined) response.email = updated.email;
    if (verified !== undefined) response.verified = updated.verified;
    if (
      suspicious !== undefined ||
      (role === "cashier" && current.suspicious === true && suspicious === undefined)
    ) response.suspicious = updated.suspicious;
    if (role !== undefined) response.role = updated.role;

    return res.status(200).json(response);
  } catch (err) {
    next(err);
  }
};


// Unimplemented placeholders
const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,20}$/;

const VALID_TRANSACTION_TYPES = new Set([
  "purchase",
  "redemption",
  "adjustment",
  "event",
  "transfer",
]);

const sumPendingRedemptions = async (userId) => {
  const pending = await prisma.transaction.findMany({
    where: { userId, type: "redemption", redeemed: null },
    select: { amount: true },
  });

  return pending.reduce((total, tx) => total + Math.abs(tx.amount), 0);
};

const patchCurrentUser = async (req, res, next) => {
  try {
    const me = req.me;
    if (!me) throw new Error("Unauthorized");

    const { name, email, birthday } = req.body;
    const avatarProvided = Object.prototype.hasOwnProperty.call(req.body, "avatar");
    const avatar = req.body.avatar;

    if (
      name === undefined &&
      email === undefined &&
      birthday === undefined &&
      !avatarProvided
    ) {
      throw new Error("Bad Request");
    }

    const data = {};

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0 || name.length > 50) {
        throw new Error("Bad Request");
      }
      data.name = name.trim();
    }

    if (email !== undefined) {
      const emailRegex = /^[A-Za-z0-9._%+-]+@(mail\.)?utoronto\.ca$/;
      if (typeof email !== "string" || !emailRegex.test(email)) {
        throw new Error("Bad Request");
      }
      data.email = email;
    }

    if (birthday !== undefined) {
      const parsed = new Date(birthday);
      if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
        throw new Error("Bad Request");
      }
      data.birthday = parsed;
    }

    if (avatarProvided) {
      if (avatar !== null && typeof avatar !== "string") {
        throw new Error("Bad Request");
      }
      if (typeof avatar === "string" && avatar.length > 2048) {
        throw new Error("Bad Request");
      }
      data.avatarUrl = avatar || null;
    }

    const updated = await prisma.user.update({
      where: { id: me.id },
      data,
      select: {
        name: true,
        email: true,
        birthday: true,
        avatarUrl: true,
      },
    });

    const response = {};
    if (name !== undefined) response.name = updated.name;
    if (email !== undefined) response.email = updated.email;
    if (birthday !== undefined)
      response.birthday = updated.birthday ? updated.birthday.toISOString() : null;
    if (avatarProvided) response.avatarUrl = updated.avatarUrl || null;

    return res.status(200).json(response);
  } catch (err) {
    next(err);
  }
};

const patchCurrentUserPassword = async (req, res, next) => {
  try {
    const me = req.me;
    if (!me) throw new Error("Unauthorized");

    const { old, new: newPassword } = req.body;
    if (!old || !newPassword) throw new Error("Bad Request");

    if (!PASSWORD_REGEX.test(newPassword)) {
      throw new Error("Bad Request");
    }

    const user = await prisma.user.findUnique({ where: { id: me.id } });
    if (!user) throw new Error("Not Found");

    const matches = await comparePassword(old, user.password);
    if (!matches) {
      throw new Error("Forbidden");
    }

    const hashed = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: me.id },
      data: { password: hashed },
    });

    return res.status(200).json({ message: "Password updated" });
  } catch (err) {
    next(err);
  }
};

const postRedemptionTransaction = async (req, res, next) => {
  try {
    const me = req.me;
    if (!me) throw new Error("Unauthorized");

    const { type, amount, remark = "" } = req.body;

    if (type !== "redemption") throw new Error("Bad Request");
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("Bad Request");
    if (typeof remark !== "string" || remark.length > 255) throw new Error("Bad Request");

    if (!me.verified) throw new Error("Forbidden");

    const user = await prisma.user.findUnique({
      where: { id: me.id },
      select: { id: true, points: true },
    });
    if (!user) throw new Error("Not Found");

    const reserved = await sumPendingRedemptions(user.id);
    if (user.points - reserved < amount) throw new Error("Bad Request");

    const transaction = await prisma.transaction.create({
      data: {
        userId: user.id,
        type: "redemption",
        amount: -amount,
        redeemed: null,
        remark,
      },
      select: {
        id: true,
        type: true,
        amount: true,
        remark: true,
        createdAt: true,
      },
    });

    return res.status(201).json({
      id: transaction.id,
      type: transaction.type,
      amount,
      remark: transaction.remark || "",
      processed: false,
      createdAt: transaction.createdAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
};

const buildTransactionResponse = (tx) => {
  const isRedemption = tx.type === "redemption";
  return {
    id: tx.id,
    type: tx.type,
    amount: isRedemption ? Math.abs(tx.amount) : tx.amount,
    spent: tx.spent,
    promotionIds: tx.promotions?.map((p) => p.id) || [],
    suspicious: tx.suspicious,
    remark: tx.remark || "",
    relatedId: tx.relatedId || undefined,
    createdBy: tx.createdBy?.utorid || null,
    processed: isRedemption ? tx.redeemed !== null : undefined,
    createdAt: tx.createdAt.toISOString(),
  };
};

const getCurrentUserTransactions = async (req, res, next) => {
  try {
    const me = req.me;
    if (!me) throw new Error("Unauthorized");

    const {
      type,
      page = 1,
      limit = 10,
      processed,
      suspicious,
    } = req.query;

    const pageNum = Number.parseInt(page, 10);
    const limitNum = Number.parseInt(limit, 10);
    if (!Number.isInteger(pageNum) || pageNum <= 0) throw new Error("Bad Request");
    if (!Number.isInteger(limitNum) || limitNum <= 0 || limitNum > 100)
      throw new Error("Bad Request");

    const where = { userId: me.id };

    if (type !== undefined) {
      if (typeof type !== "string" || !VALID_TRANSACTION_TYPES.has(type)) {
        throw new Error("Bad Request");
      }
      where.type = type;
    }

    if (processed !== undefined) {
      if (processed !== "true" && processed !== "false") {
        throw new Error("Bad Request");
      }
      where.redeemed = processed === "true" ? { not: null } : null;
    }

    if (suspicious !== undefined) {
      if (suspicious !== "true" && suspicious !== "false") {
        throw new Error("Bad Request");
      }
      where.suspicious = suspicious === "true";
    }

    const [count, transactions] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where,
        include: {
          promotions: { select: { id: true } },
          createdBy: { select: { utorid: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
    ]);

    const results = transactions.map(buildTransactionResponse);

    return res.status(200).json({ count, results });
  } catch (err) {
    next(err);
  }
};

const getUserTransactions = async (req, res, next) => {
  try {
    const userId = Number.parseInt(req.params.userId, 10);
    if (!Number.isInteger(userId) || userId <= 0) throw new Error("Bad Request");

    const {
      type,
      page = 1,
      limit = 10,
      suspicious,
      processed,
    } = req.query;

    const pageNum = Number.parseInt(page, 10);
    const limitNum = Number.parseInt(limit, 10);
    if (!Number.isInteger(pageNum) || pageNum <= 0) throw new Error("Bad Request");
    if (!Number.isInteger(limitNum) || limitNum <= 0 || limitNum > 100)
      throw new Error("Bad Request");

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("Not Found");

    const where = { userId };

    if (type !== undefined) {
      if (typeof type !== "string" || !VALID_TRANSACTION_TYPES.has(type)) {
        throw new Error("Bad Request");
      }
      where.type = type;
    }

    if (suspicious !== undefined) {
      if (suspicious !== "true" && suspicious !== "false") {
        throw new Error("Bad Request");
      }
      where.suspicious = suspicious === "true";
    }

    if (processed !== undefined) {
      if (processed !== "true" && processed !== "false") {
        throw new Error("Bad Request");
      }
      where.redeemed = processed === "true" ? { not: null } : null;
    }

    const [count, transactions] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where,
        include: {
          promotions: { select: { id: true } },
          createdBy: { select: { utorid: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
    ]);

    const results = transactions.map(buildTransactionResponse);

    return res.status(200).json({ count, results });
  } catch (err) {
    next(err);
  }
};

const postTransferTransaction = async (req, res, next) => {
  try {
    const me = req.me;
    if (!me) throw new Error("Unauthorized");

    const recipientId = Number.parseInt(req.params.userId, 10);
    if (!Number.isInteger(recipientId) || recipientId <= 0) {
      throw new Error("Bad Request");
    }

    const { type, amount, remark = "" } = req.body;

    if (type !== "transfer") throw new Error("Bad Request");
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("Bad Request");
    if (typeof remark !== "string" || remark.length > 255) throw new Error("Bad Request");

    if (!me.verified) throw new Error("Forbidden");
    if (me.id === recipientId) throw new Error("Bad Request");

    const recipient = await prisma.user.findUnique({ where: { id: recipientId } });
    if (!recipient) throw new Error("Not Found");
    if (!recipient.verified) throw new Error("Forbidden");

    const sender = await prisma.user.findUnique({
      where: { id: me.id },
      select: { id: true, points: true },
    });
    if (!sender) throw new Error("Not Found");

    const reserved = await sumPendingRedemptions(sender.id);
    if (sender.points - reserved < amount) throw new Error("Bad Request");

    const result = await prisma.$transaction(async (tx) => {
      const freshSender = await tx.user.findUnique({
        where: { id: sender.id },
        select: { points: true },
      });

      if (!freshSender || freshSender.points < amount) {
        throw new Error("Bad Request");
      }

      await tx.user.update({
        where: { id: sender.id },
        data: { points: { decrement: amount } },
      });

      const recipientAfter = await tx.user.update({
        where: { id: recipientId },
        data: { points: { increment: amount } },
        select: { points: true },
      });

      const senderTx = await tx.transaction.create({
        data: {
          userId: sender.id,
          type: "transfer",
          amount: -amount,
          remark,
          createdById: sender.id,
        },
      });

      const recipientTx = await tx.transaction.create({
        data: {
          userId: recipientId,
          type: "transfer",
          amount,
          remark,
          createdById: sender.id,
          relatedId: senderTx.id,
        },
      });

      await tx.transaction.update({
        where: { id: senderTx.id },
        data: { relatedId: recipientTx.id },
      });

      return {
        senderTx,
        recipientTx,
        senderPoints: freshSender.points - amount,
        recipientPoints: recipientAfter.points,
      };
    });

    return res.status(201).json({
      sender: {
        id: result.senderTx.id,
        amount: -amount,
        remark,
        points: result.senderPoints,
      },
      recipient: {
        id: result.recipientTx.id,
        amount,
        remark,
        points: result.recipientPoints,
      },
    });
  } catch (err) {
    next(err);
  }
};


module.exports = {
  postUser,
  getUsers,
  getCurrentUser,
  getUserById,
  patchUserById,
  patchCurrentUser,
  patchCurrentUserPassword,
  postRedemptionTransaction,
  getCurrentUserTransactions,
  getUserTransactions,
  postTransferTransaction,
};