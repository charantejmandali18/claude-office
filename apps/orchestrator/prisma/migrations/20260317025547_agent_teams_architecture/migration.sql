-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'IDLE', 'STOPPED');

-- DropForeignKey
ALTER TABLE "Agent" DROP CONSTRAINT "Agent_parentId_fkey";

-- AlterTable
ALTER TABLE "Agent" DROP COLUMN "parentId",
DROP COLUMN "pid",
DROP COLUMN "startedAt",
ADD COLUMN     "parentAgentId" TEXT,
ADD COLUMN     "sessionId" TEXT,
ADD COLUMN     "taskId" TEXT;

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "teamName" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActive" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionId_key" ON "Session"("sessionId");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_parentAgentId_fkey" FOREIGN KEY ("parentAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
