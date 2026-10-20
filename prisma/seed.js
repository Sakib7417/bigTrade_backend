import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed...');

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.warn('ADMIN_EMAIL / ADMIN_PASSWORD not set - skipping admin creation');
  } else {
    const adminPasswordHash = await bcrypt.hash(adminPassword, 10);

    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        name: 'System Admin',
        email: adminEmail,
        mobile: process.env.ADMIN_MOBILE || '+10000000000',
        passwordHash: adminPasswordHash,
        role: 'ADMIN',
        referralCode: generateReferralCode('ADMIN'),
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });

    await prisma.wallet.upsert({
      where: { userId: admin.id },
      update: {},
      create: { userId: admin.id, availableBalance: 0, lockedBalance: 0 },
    });

    console.log('Admin user created:', admin.email);
  }

  // 20-level commission configuration
  const commissionLevels = [
    { level: 1, percent: 20 },
    { level: 2, percent: 10 },
    { level: 3, percent: 7.5 },
    { level: 4, percent: 5 },
    { level: 5, percent: 2.5 },
    { level: 6, percent: 1 },
    { level: 7, percent: 1 },
    { level: 8, percent: 1 },
    { level: 9, percent: 1 },
    { level: 10, percent: 1 },
    { level: 11, percent: 0.5 },
    { level: 12, percent: 0.5 },
    { level: 13, percent: 0.5 },
    { level: 14, percent: 0.5 },
    { level: 15, percent: 0.5 },
    { level: 16, percent: 0.5 },
    { level: 17, percent: 0.5 },
    { level: 18, percent: 0.5 },
    { level: 19, percent: 0.5 },
    { level: 20, percent: 0.5 },
  ];

  for (const levelData of commissionLevels) {
    await prisma.commissionLevel.upsert({
      where: { level: levelData.level },
      update: { percent: levelData.percent },
      create: levelData,
    });
  }

  console.log('Commission levels created');

  // System settings
  const settings = [
    { key: 'MIN_INVESTMENT', value: process.env.MIN_INVESTMENT || '100', description: 'Minimum investment amount' },
    { key: 'MIN_WITHDRAWAL', value: process.env.MIN_WITHDRAWAL || '15', description: 'Minimum withdrawal amount' },
    { key: 'WITHDRAWAL_FEE_PERCENT', value: process.env.WITHDRAWAL_FEE_PERCENT || '5', description: 'Withdrawal fee percentage' },
    { key: 'EARLY_PRINCIPAL_PENALTY_PERCENT', value: process.env.EARLY_PRINCIPAL_PENALTY_PERCENT || '10', description: 'Early principal withdrawal penalty' },
    { key: 'DIRECT_COMMISSION_PERCENT', value: process.env.DIRECT_COMMISSION_PERCENT || '5', description: 'Direct referral commission percentage' },
    { key: 'MIN_ROI_PERCENT', value: process.env.MIN_ROI_PERCENT || '6', description: 'Minimum ROI percentage' },
    { key: 'MAX_ROI_PERCENT', value: process.env.MAX_ROI_PERCENT || '12', description: 'Maximum ROI percentage' },
    { key: 'MAX_REFERRAL_LEVEL', value: process.env.MAX_REFERRAL_LEVEL || '20', description: 'Maximum referral depth' },
    { key: 'EARNING_CAP_MULTIPLIER', value: '10', description: 'Promoter capping multiplier (10x)' },
    { key: 'DAILY_ROI_MIN_PCT', value: process.env.DAILY_ROI_MIN_PCT || '0.1', description: 'Minimum allowed daily ROI rate (%) — guide target is 10% per 30-day cycle' },
    { key: 'DAILY_ROI_MAX_PCT', value: process.env.DAILY_ROI_MAX_PCT || '1.0', description: 'Maximum allowed daily ROI rate (%) — cycle total hard-capped at 12%' },
  ];

  for (const setting of settings) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value, description: setting.description },
      create: setting,
    });
  }

  console.log('System settings created');

  // Optional: seed a default global ROI only if explicitly configured
  if (process.env.SEED_GLOBAL_ROI_PERCENT && process.env.SEED_GLOBAL_ROI_PERIOD) {
    await prisma.roiConfiguration.upsert({
      where: {
        type_period_userId_investmentId: {
          type: 'GLOBAL',
          period: process.env.SEED_GLOBAL_ROI_PERIOD,
          userId: null,
          investmentId: null,
        },
      },
      update: {},
      create: {
        type: 'GLOBAL',
        roiPercent: process.env.SEED_GLOBAL_ROI_PERCENT,
        period: process.env.SEED_GLOBAL_ROI_PERIOD,
        isActive: true,
      },
    });
    console.log(`Global ROI seeded: ${process.env.SEED_GLOBAL_ROI_PERCENT}% for ${process.env.SEED_GLOBAL_ROI_PERIOD}`);
  }

  console.log('Seed completed successfully!');
}

function generateReferralCode(prefix) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = prefix || '';
  for (let i = code.length; i < 12; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
