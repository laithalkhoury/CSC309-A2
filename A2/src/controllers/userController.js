const { v4: uuidv4 } = require("uuid");
const prisma = require("../prismaClient");
const { generateToken } = require("../services/jwt");
const { hashPassword, comparePassword } = require("../services/bcrypt");


// POST /users - Register a new user
export const postUser = async (req, res) => {

    const { utorid, name, email } = req.body;

    if (!utorid || !name || !email) {
        throw new Error("Bad Request");
    }

    const utoridRegex = /^[a-zA-Z0-9]{7,8}$/;
    if (!utoridRegex.test(utorid)) {
        throw new Error("Bad Request");
    }


    if (name.length < 1 || name.length > 50) {
        throw new Error("Bad Request");
    }

    
    const emailRegex = /^[A-Za-z0-9._%+-]+@(mail\.)?utoronto\.ca$/;
    if (!emailRegex.test(email)) {
        throw new Error("Bad Request");
    }

    const existing = await prisma.user.findFirst({
        where: { utorid }
    });

    if (existing){
        throw new Error("Conflict");
    }


    const resetToken = uuidv4();
    const resetExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    
    const user = await prisma.user.create({
        data: {
        utorid,
        name,
        email,
        verified: false,
        resetToken,
        resetExpiresAt,
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

    if (!user) {
        throw new Error("Bad Request");
    }

    
    return res.status(201).json({
        ...user,
        expiresAt: user.resetExpiresAt,
    });
};



// GET /users - Retrieve a list of users. (manager or higher) - this check is done in authentication middleware
export const getUsers = async (req, res) => {
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
};


// GET /users/me - Get current authenticated user
  export const getCurrentUser = async (req, res) => {
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
      usedByUsers: { none: { id: me.id } }, // user hasn't used it yet
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
}

// GET /users/:userId (separated by roletype)
export const getUserById = async (req, res) => {
  const id = Number(req.params.userId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Bad Request");

  const meRole = req.me?.role; // set by auth middleware
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
};


// updates user identified by Id
export const patchUserById = async (req, res) => {
    const id = Number(req.params.userId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Bad Request");

  const { email, verified, suspicious, role } = req.body;

  if (
    email === undefined &&
    verified === undefined &&
    suspicious === undefined &&
    role === undefined
  ) {
    throw new Error("Bad Request");
  }

  const meRole = req.me?.role;
  if (!meRole) throw new Error("Unauthorized");

  if (role !== undefined) {
    if (
      role !== "regular" &&
      role !== "cashier" &&
      role !== "manager" &&
      role !== "superuser"
    ) {
      throw new Error("Bad Request");
    }
    if (
      meRole === "manager" &&
      role !== "regular" &&
      role !== "cashier"
    ) {
      throw new Error("Forbidden");
    }
  }

  if (email !== undefined) {
    const emailOk = typeof email === "string" &&
      /^[A-Za-z0-9._%+-]+@(mail\.)?utoronto\.ca$/.test(email);
    if (!emailOk) throw new Error("Bad Request");
  }

  if (verified !== undefined) {
    if (verified !== true) throw new Error("Bad Request");
  }

  if (suspicious !== undefined) {
    if (typeof suspicious !== "boolean") throw new Error("Bad Request");
  }

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
      role: true
    }
  });

  if (email !== undefined) response.email = updated.email;
  if (verified !== undefined) response.verified = updated.verified;
  if (
    suspicious !== undefined ||
    (role === "cashier" && current.suspicious === true && suspicious === undefined)
  ) {
    response.suspicious = updated.suspicious;
  }
  if (role !== undefined) response.role = updated.role;

  return res.status(200).json(response);
}

