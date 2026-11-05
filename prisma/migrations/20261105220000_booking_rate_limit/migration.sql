CREATE TABLE "BookingRateLimit" (
    "shop" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingRateLimit_pkey" PRIMARY KEY ("shop", "key")
);

CREATE INDEX "BookingRateLimit_shop_expiresAt_idx" ON "BookingRateLimit"("shop", "expiresAt");
