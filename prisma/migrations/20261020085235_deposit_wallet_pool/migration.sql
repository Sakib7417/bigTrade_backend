-- CreateTable
CREATE TABLE "DepositWallet" (
    "id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepositWallet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DepositWallet_network_active_idx" ON "DepositWallet"("network", "active");

-- CreateIndex
CREATE UNIQUE INDEX "DepositWallet_network_address_key" ON "DepositWallet"("network", "address");
