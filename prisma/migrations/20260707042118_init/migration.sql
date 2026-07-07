-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nickname" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Banner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "rateUp6" TEXT NOT NULL,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Pull" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "bannerId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "rarity" INTEGER NOT NULL,
    "operatorName" TEXT NOT NULL,
    "pulledAt" DATETIME NOT NULL,
    CONSTRAINT "Pull_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Pull_bannerId_fkey" FOREIGN KEY ("bannerId") REFERENCES "Banner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_tokenHash_key" ON "User"("tokenHash");

-- CreateIndex
CREATE INDEX "Pull_bannerId_rarity_idx" ON "Pull"("bannerId", "rarity");

-- CreateIndex
CREATE UNIQUE INDEX "Pull_userId_bannerId_seq_key" ON "Pull"("userId", "bannerId", "seq");
