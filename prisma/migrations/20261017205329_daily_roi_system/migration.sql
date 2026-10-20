-- CreateEnum
CREATE TYPE "DailyRoiRateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PROCESSED', 'LOCKED');

-- CreateEnum
CREATE TYPE "RoiPayoutStatus" AS ENUM ('CREDITED', 'CAPPED', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "DailyRoiRate" (
    "id" TEXT NOT NULL,
    "roiDate" DATE NOT NULL,
    "ratePercent" DECIMAL(12,6) NOT NULL,
    "status" "DailyRoiRateStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "previousRate" DECIMAL(12,6),
    "createdBy" TEXT,
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyRoiRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoiPayout" (
    "id" TEXT NOT NULL,
    "dailyRoiRateId" TEXT NOT NULL,
    "roiDate" DATE NOT NULL,
    "userId" TEXT NOT NULL,
    "investmentId" TEXT NOT NULL,
    "ratePercent" DECIMAL(12,6) NOT NULL,
    "eligiblePrincipal" DECIMAL(20,2) NOT NULL,
    "calculatedAmount" DECIMAL(20,6) NOT NULL,
    "creditedAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "cycleIndex" INTEGER NOT NULL,
    "status" "RoiPayoutStatus" NOT NULL,
    "failureReason" TEXT,
    "walletTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoiPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyRoiRate_roiDate_key" ON "DailyRoiRate"("roiDate");

-- CreateIndex
CREATE INDEX "DailyRoiRate_status_idx" ON "DailyRoiRate"("status");

-- CreateIndex
CREATE INDEX "RoiPayout_userId_idx" ON "RoiPayout"("userId");

-- CreateIndex
CREATE INDEX "RoiPayout_roiDate_idx" ON "RoiPayout"("roiDate");

-- CreateIndex
CREATE INDEX "RoiPayout_status_idx" ON "RoiPayout"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RoiPayout_investmentId_roiDate_key" ON "RoiPayout"("investmentId", "roiDate");

-- AddForeignKey
ALTER TABLE "RoiPayout" ADD CONSTRAINT "RoiPayout_dailyRoiRateId_fkey" FOREIGN KEY ("dailyRoiRateId") REFERENCES "DailyRoiRate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoiPayout" ADD CONSTRAINT "RoiPayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoiPayout" ADD CONSTRAINT "RoiPayout_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "Investment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
