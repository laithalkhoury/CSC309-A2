const { v4: uuidv4 } = require("uuid");
const prisma = require("../prismaClient");
const { generateToken } = require("../services/jwt");
const { hashPassword, comparePassword } = require("../services/bcrypt");

const rateLimiter = new Map();

/**
 * POST /auth/tokens
 * Authenticate user and issue JWT token
 */
const authUser = async (req, res, next) => {
  try {
    const { utorid, password } = req.body;

    if (!utorid || !password) {
      throw new Error("Bad Request");
    }

    const user = await prisma.user.findUnique({ where: { utorid } });
    if (!user || !user.password) {
      throw new Error("Unauthorized");
    }

    const passwordMatch = await comparePassword(password, user.password);
    if (!passwordMatch) {
      throw new Error("Unauthorized");
    }

    const { token, expiresAt } = generateToken(user);

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    return res.status(200).json({ token, expiresAt });
  } catch (err) {
    next(err); // Forward to global error handler
  }
};

/**
 * POST /auth/resets
 * Request password reset
 */
const requestPasswordReset = async (req, res, next) => {
  try {
    const { utorid } = req.body;

    if (!utorid) {
      throw new Error("Bad Request");
    }

    const clientIp = req.ip || "unknown";
    const key = `${clientIp}:${utorid.toLowerCase()}`;
    const now = Date.now();
    const lastRequestTime = rateLimiter.get(key);

    if (lastRequestTime && now - lastRequestTime < 60 * 1000) {
      return res.status(429).json({ error: "Too Many Requests" });
    }

    rateLimiter.set(key, now);

    // Clean entries older than one minute to keep the map bounded
    const cutoff = now - 60 * 1000;
    for (const [storedKey, timestamp] of rateLimiter.entries()) {
      if (timestamp < cutoff) {
        rateLimiter.delete(storedKey);
      }
    }

    const user = await prisma.user.findUnique({ where: { utorid } });
    if (!user) {
      throw new Error("Not Found");
    }

    const resetToken = uuidv4();
    const resetExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken,
        resetExpiresAt,
      },
    });

    return res.status(202).json({
      resetToken,
      expiresAt: resetExpiresAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /auth/resets/:resetToken
 * Reset password
 */
const resetPassword = async (req, res, next) => {
  try {
    const { resetToken } = req.params;
    const { utorid, password } = req.body;

    if (!utorid || !password) {
      throw new Error("Bad Request");
    }

    const passwordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,20}$/;
    if (!passwordRegex.test(password)) {
      throw new Error("Bad Request");
    }

    const user = await prisma.user.findUnique({
      where: { resetToken },
    });

    if (!user) {
      throw new Error("Not Found");
    }

    if (user.utorid !== utorid) {
      throw new Error("Unauthorized");
    }

    if (!user.resetExpiresAt || new Date() > user.resetExpiresAt) {
      throw new Error("Gone");
    }

    const hashedPassword = await hashPassword(password);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetExpiresAt: null,
        verified: true,
      },
    });

    return res.status(200).json({ message: "Password reset successful" });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  authUser,
  requestPasswordReset,
  resetPassword,
};
