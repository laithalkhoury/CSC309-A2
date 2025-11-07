// middleware/authMiddleware.js

const { expressjwt: jwt } = require("express-jwt");
const prisma = require("../prismaClient");

const authenticate = jwt({
  secret: process.env.JWT_SECRET || "secretkey",
  algorithms: ["HS256"],
});

function requires(minRole) {
  const ranking = { regular: 1, cashier: 2, manager: 3, superuser: 4 };

  return async (req, res, next) => {
    try {
      if (!req.auth || !req.auth.userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const me = await prisma.user.findUnique({ where: { id: req.auth.userId } });
      if (!me) return res.status(401).json({ error: "Unauthorized" });

      req.me = me;

      if (ranking[me.role] < ranking[minRole]) {
        return res.status(403).json({ error: "Forbidden" });
      }

      return next();
    } catch (err) {
      next(err);
    }
  };
}

/** Always attach the logged-in user (if any) to req.me */
async function attachUser(req, res, next) {
  if (req.auth?.userId) {
    req.me = await prisma.user.findUnique({ where: { id: req.auth.userId } });
  }
  next();
}

module.exports = { authenticate, requires, attachUser };
