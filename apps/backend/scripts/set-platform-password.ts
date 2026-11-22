import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const email = process.env.PLATFORM_USER_EMAIL?.trim().toLowerCase();
const password = process.env.PLATFORM_USER_PASSWORD;
const name = process.env.PLATFORM_USER_NAME?.trim() || 'Super Administrator';
const role = process.env.PLATFORM_USER_ROLE?.trim() || 'SUPER_ADMIN';

if (!email || !password) {
  console.error('PLATFORM_USER_EMAIL and PLATFORM_USER_PASSWORD are required.');
  process.exit(1);
}
if (password.length < 12) {
  console.error('PLATFORM_USER_PASSWORD must be at least 12 characters.');
  process.exit(1);
}
if (role !== 'SUPER_ADMIN' && role !== 'SUPPORT') {
  console.error('PLATFORM_USER_ROLE must be SUPER_ADMIN or SUPPORT.');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.platformUser.findUnique({ where: { email } });

  if (existing) {
    await prisma.platformUser.update({
      where: { email },
      data: { passwordHash, isActive: true, role },
    });
    console.log(`[platform-password] Updated existing user: ${email}`);
  } else {
    await prisma.platformUser.create({
      data: { name, email, passwordHash, role, isActive: true },
    });
    console.log(`[platform-password] Created user: ${email}`);
  }
}

main()
  .catch((error) => {
    console.error('[platform-password] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
