// middleware/authMiddleware.js

const { expressjwt: jwt } = require("express-jwt");
const prisma = require("../prismaClient");

const authenticate = jwt({
  secret: process.env.JWT_SECRET || "secretkey",
  algorithms: ["HS256"],
  requestProperty: 'auth',
  credentialsRequired: true,
  getToken: function fromHeaderOrQuerystring (req) {
    if (req.headers.authorization && req.headers.authorization.split(' ')[0] === 'Bearer') {
      return req.headers.authorization.split(' ')[1];
    } else if (req.query && req.query.token) {
      return req.query.token;
    }
    return null;
  }
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

      // Check if role is valid
      const userRanking = ranking[me.role];
      const requiredRanking = ranking[minRole];

      if (userRanking === undefined) {
        console.error(`[AUTH] Invalid user role: ${me.role} (typeof: ${typeof me.role})`);
        console.error(`[AUTH] Available roles:`, Object.keys(ranking));
        return res.status(403).json({ error: "Forbidden" });
      }

      if (requiredRanking === undefined) {
        console.error(`[AUTH] Invalid required role: ${minRole}`);
        return res.status(403).json({ error: "Forbidden" });
      }

      if (userRanking < requiredRanking) {
        console.log(`[AUTH] User ${me.utorid} (${me.role}:${userRanking}) < required (${minRole}:${requiredRanking}) - FORBIDDEN`);
        return res.status(403).json({ error: "Forbidden" });
      }

      console.log(`[AUTH] User ${me.utorid} (${me.role}:${userRanking}) >= required (${minRole}:${requiredRanking}) - OK`);


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
