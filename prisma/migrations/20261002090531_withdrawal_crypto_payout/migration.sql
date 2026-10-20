/*
  Warnings:

  - A unique constraint covering the columns `[payoutTxHash]` on the table `Withdrawal` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Withdrawal" ADD COLUMN     "destinationAddress" TEXT,
ADD COLUMN     "payoutTxHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Withdrawal_payoutTxHash_key" ON "Withdrawal"("payoutTxHash");
