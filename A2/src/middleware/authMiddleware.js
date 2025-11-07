/* Authentication Middleware Logic */

const { expressjwt: jwt } = require("express-jwt");
const prisma = require("../prismaClient");

const baseAuthenticate = jwt({
  secret: process.env.JWT_SECRET || "secretkey",
  algorithms: ["HS256"],
  requestProperty: "auth",
});

const attachUser = async (req, res, next) => {
  try {
    if (!req.auth || !req.auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    req.me = user;
    next();
  } catch (err) {
    next(err);
  }
};

const authenticate = [baseAuthenticate, attachUser];

function requires(minRole) {
  const ranking = { regular: 1, cashier: 2, manager: 3, superuser: 4 };

  return (req, res, next) => {
    try {
      if (!req.me) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (ranking[req.me.role] < ranking[minRole]) {
        return res.status(403).json({ error: "Forbidden" });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { authenticate, requires };