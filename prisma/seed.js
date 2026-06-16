import 'dotenv/config';
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rmsoft.rw';
const ADMIN_PASS = process.env.SEED_ADMIN_PASS ?? 'changeme123';

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (existing) {
    console.log('admin already exists:', ADMIN_EMAIL);
    return;
  }
  const passwordHash = await argon2.hash(ADMIN_PASS);
  await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      passwordHash,
      fullName: 'RMSoft Admin',
      role: 'SUPER',
    },
  });
  console.log('seeded admin:', ADMIN_EMAIL, '/', ADMIN_PASS);
  console.log('CHANGE THE PASSWORD before deploying.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
