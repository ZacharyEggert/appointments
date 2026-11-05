ALTER TABLE "Resource" ADD COLUMN "openingHours" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE "ShopSettings" (
    "shop" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "startIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "bufferBeforeMinutes" INTEGER NOT NULL DEFAULT 0,
    "bufferAfterMinutes" INTEGER NOT NULL DEFAULT 0,
    "minNoticeMinutes" INTEGER NOT NULL DEFAULT 0,
    "maxAdvanceDays" INTEGER NOT NULL DEFAULT 30,
    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("shop")
);
