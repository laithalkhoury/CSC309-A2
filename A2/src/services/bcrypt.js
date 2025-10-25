import bcrypt from "bcrypt";

const ROUNDS = 10;

export async function hashPassword(password) {
  return bcrypt.hash(password, ROUNDS);
}

export async function comparePassword(password, hashed) {
  return bcrypt.compare(password, hashed);
}
