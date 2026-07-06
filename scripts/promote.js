// Promote (or demote) a user's role. Usage:
//   node scripts/promote.js <email> <USER|ADMIN|SUPER>
// Runs against whatever DATABASE_URL is in the environment (use `railway run` for production).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const [, , email, roleArg] = process.argv;
const role = (roleArg || "SUPER").toUpperCase();

if (!email || !["USER", "ADMIN", "SUPER"].includes(role)) {
  console.error("Usage: node scripts/promote.js <email> <USER|ADMIN|SUPER>");
  process.exit(1);
}

const user = await prisma.user.update({
  where: { email },
  data: { role },
}).catch((e) => {
  console.error(`Could not update ${email}:`, e.message);
  process.exit(1);
});

console.log(`✅ ${user.email} is now ${user.role}. Sign out and back in to refresh your session.`);
await prisma.$disconnect();
