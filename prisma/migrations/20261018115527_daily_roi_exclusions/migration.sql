-- CreateTable
CREATE TABLE "DailyRoiExclusion" (
    "id" TEXT NOT NULL,
    "roiDate" DATE NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyRoiExclusion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyRoiExclusion_roiDate_idx" ON "DailyRoiExclusion"("roiDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyRoiExclusion_roiDate_userId_key" ON "DailyRoiExclusion"("roiDate", "userId");

-- AddForeignKey
ALTER TABLE "DailyRoiExclusion" ADD CONSTRAINT "DailyRoiExclusion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
