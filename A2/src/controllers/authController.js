import { v4 as uuidv4 } from "uuid";
import { PrismaClient } from "@prisma/client";
import { generateToken } from "../services/jwt.js";
import { hashPassword, comparePassword } from "../services/bcrypt.js";

const prisma = new PrismaClient();

const rateLimiter = new Map();

/**
 * POST /auth/tokens
 * Authenticate user and issue JWT token
 */
export const authUser = async (req, res) => {
    try {
        const { utorid, password } = req.body;

        if (!utorid || !password) {
            return res.status(400).json({ error: "utorid and password are required" });
        }

        const user = await prisma.user.findUnique({ where: { utorid } });
        if (!user || !user.password) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const passwordMatch = await comparePassword(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const { token, expiresAt } = generateToken(user);

        await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() },
        });

        return res.status(200).json({ token, expiresAt });

    } catch (error) {
        console.error("Error authenticating user:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

/**
 * POST /auth/resets
 * Request password reset
 */
export const requestPasswordReset = async (req, res) => {
    try {
        const { utorid } = req.body;

        if (!utorid) {
            return res.status(400).json({ error: "utorid is required" });
        }

        const clientIp = req.ip;
        const now = Date.now();
        const lastRequestTime = rateLimiter.get(clientIp);

        if (lastRequestTime && now - lastRequestTime < 60 * 1000) {
            return res.status(429).json({ error: "Too many requests" });
        }

        rateLimiter.set(clientIp, now);

        if (rateLimiter.size > 1000) {
            const cutoff = now - 60000;
            for (const [ip, timestamp] of rateLimiter.entries()) {
                if (timestamp < cutoff) {
                    rateLimiter.delete(ip);
                }
            }
        }

        const user = await prisma.user.findUnique({ where: { utorid } });

        const resetToken = uuidv4();
        const resetExpiresAt = new Date(Date.now() + 60 * 60 * 1000);

        if (user) {
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    resetToken,
                    resetExpiresAt,
                },
            });
        }

        return res.status(202).json({
            expiresAt: resetExpiresAt.toISOString(),
            resetToken
        });

    } catch (error) {
        console.error("Error requesting password reset:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

/**
 * POST /auth/resets/:resetToken
 * Reset password
 */
export const resetPassword = async (req, res) => {
    try {
        const { resetToken } = req.params;
        const { utorid, password } = req.body;

        if (!utorid || !password) {
            return res.status(400).json({ error: "utorid and password are required" });
        }

        // Validate password strength
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,20}$/;
        if (!passwordRegex.test(password)) {
            return res.status(400).json({
                error: "Password must be 8-20 characters with at least one uppercase, lowercase, number, and special character"
            });
        }

        const user = await prisma.user.findFirst({
            where: { utorid, resetToken }
        });

        if (!user) {
            return res.status(404).json({ error: "Invalid reset token" });
        }

        if (user.resetExpiresAt && new Date() > user.resetExpiresAt) {
            return res.status(410).json({ error: "Reset token has expired" });
        }

        const hashedPassword = await hashPassword(password);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                resetToken: null,
                resetExpiresAt: null,
            },
        });

        return res.status(200).json({ message: "Password has been reset successfully" });

    } catch (error) {
        console.error("Error resetting password:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};
