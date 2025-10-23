// generates one prisma client for whole server to use.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
module.exports = prisma;