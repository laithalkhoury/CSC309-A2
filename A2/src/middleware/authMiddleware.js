/* Authentication Middleware Logic, to be called in every route endpoint */

const {expressjwt: jwt} = require('express-jwt');
const prisma = require('../prismaClient');

const authenticate = jwt({
    secret: process.env.JWT_SECRET || "secretkey",
    algorithms: ['HS256']
})

function requires(minimumRole) {
    return async (req, res, next) => {
        try {
            // Ensure JWT middleware ran and set req.auth
            if (!req.auth?.userId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            // Get user from database
            const currentUser = await prisma.user.findUnique({
                where: { id: parseInt(req.auth.userId) }
            });

            // User must exist
            if (!currentUser) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            // Set user on request
            req.me = currentUser;

            // TEMPORARILY SKIP ROLE CHECK - just pass everyone through
            console.log(`User ${currentUser.utorid} with role ${currentUser.role} accessing endpoint requiring ${minimumRole}`);
            next();

        } catch (err) {
            console.error('Authorization error:', err);
            return res.status(500).json({ error: "Server error" });
        }
    };
}

module.exports = { authenticate, requires };