-- CreateEnum
CREATE TYPE "CryptoDepositStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CREDITED', 'REJECTED');

-- CreateTable
CREATE TABLE "CryptoDeposit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "asset" TEXT NOT NULL DEFAULT 'USDT',
    "network" TEXT NOT NULL DEFAULT 'bsc-testnet',
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "status" "CryptoDepositStatus" NOT NULL DEFAULT 'PENDING',
    "walletTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CryptoDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CryptoDeposit_txHash_key" ON "CryptoDeposit"("txHash");

-- CreateIndex
CREATE INDEX "CryptoDeposit_userId_idx" ON "CryptoDeposit"("userId");

-- CreateIndex
CREATE INDEX "CryptoDeposit_status_idx" ON "CryptoDeposit"("status");

-- CreateIndex
CREATE INDEX "CryptoDeposit_createdAt_idx" ON "CryptoDeposit"("createdAt");

-- AddForeignKey
ALTER TABLE "CryptoDeposit" ADD CONSTRAINT "CryptoDeposit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
