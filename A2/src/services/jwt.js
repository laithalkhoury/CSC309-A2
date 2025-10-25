import jwt from "jsonwebtoken";

export function generateToken(user) {
  const expiresIn = "7d";
  const token = jwt.sign(
    { userId: user.id, role: user.role },
    process.env.JWT_SECRET || "secretkey",
    { expiresIn }
  );

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  return { token, expiresAt };
}
