-- CreateTable
CREATE TABLE "GoogleOAuthState" (
    "state" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleOAuthState_pkey" PRIMARY KEY ("state")
);

-- CreateIndex
CREATE INDEX "GoogleOAuthState_shop_idx" ON "GoogleOAuthState"("shop");
