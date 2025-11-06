const bcrypt = require("bcrypt");
const ROUNDS = 10;

async function hashPassword(password) {
  return bcrypt.hash(password, ROUNDS);
}

async function comparePassword(password, hashed) {
  return bcrypt.compare(password, hashed);
}

module.exports = {
  hashPassword,
  comparePassword,
};