-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'RANK_REWARD';

-- CreateTable
CREATE TABLE "RankReward" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "reward" DECIMAL(20,2) NOT NULL,
    "legsUsed" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankReward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RankReward_userId_idx" ON "RankReward"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RankReward_userId_rank_key" ON "RankReward"("userId", "rank");

-- AddForeignKey
ALTER TABLE "RankReward" ADD CONSTRAINT "RankReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
