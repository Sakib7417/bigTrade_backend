-- AlterTable
ALTER TABLE "Withdrawal" ADD COLUMN     "claimAmountRaw" TEXT,
ADD COLUMN     "claimContract" TEXT,
ADD COLUMN     "claimExpiry" TIMESTAMP(3),
ADD COLUMN     "claimIssuedAt" TIMESTAMP(3),
ADD COLUMN     "claimNonce" TEXT,
ADD COLUMN     "claimSignature" TEXT,
ADD COLUMN     "network" TEXT NOT NULL DEFAULT 'BEP20';
