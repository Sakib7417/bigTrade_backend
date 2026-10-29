-- AlterTable
ALTER TABLE "User" ADD COLUMN     "withdrawalPasswordHash" TEXT,
ADD COLUMN     "withdrawalPasswordSetAt" TIMESTAMP(3);
