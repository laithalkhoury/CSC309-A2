/*
 * Complete this script so that it is able to add a superuser to the database
 * Usage example: 
 *   node prisma/createsu.js clive123 clive.su@mail.utoronto.ca SuperUser123!
 */
'use strict';

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {

  const [,, utorid, email, password] = process.argv;

  if (!utorid || !email || !password) {
    console.error('Usage: node prisma/createsu.js <utorid> <email> <password>');
    process.exit(1);
  }

  if (utorid.length < 7 || utorid.length > 8) {
    console.error('❌ Invalid utorid. It must be 7 or 8 characters long.');
    process.exit(1);
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    console.error('⚠️  A user with this email already exists.');
    process.exit(1);
  }

  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash(password, saltRounds);

  const superuser = await prisma.user.create({
    data: {
      utorid,
      email,
      name: 'Super User',
      password: hashedPassword,
      verified: true,
      role: 'superuser',
    },
  });

  console.log(`✅ Superuser created: ${superuser.utorid} (${superuser.email})`);
}

main()
  .catch((err) => {
    console.error('❌ Error creating superuser:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
