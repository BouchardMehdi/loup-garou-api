-- CreateEnum
CREATE TYPE "NightActionKind" AS ENUM ('WOLF_ATTACK', 'SEER_INSPECT');

-- AlterTable
ALTER TABLE "GamePhase" ADD COLUMN     "eliminatedParticipantId" UUID;

-- CreateTable
CREATE TABLE "NightAction" (
    "id" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "phaseId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "targetId" UUID,
    "kind" "NightActionKind" NOT NULL,
    "inspectedRoleCode" VARCHAR(32),
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NightAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VillageVote" (
    "id" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "phaseId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "targetId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VillageVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NightAction_phaseId_actorId_key" ON "NightAction"("phaseId", "actorId");

-- CreateIndex
CREATE UNIQUE INDEX "VillageVote_phaseId_actorId_key" ON "VillageVote"("phaseId", "actorId");

-- CreateIndex
CREATE UNIQUE INDEX "GameParticipant_id_gameId_key" ON "GameParticipant"("id", "gameId");

-- CreateIndex
CREATE UNIQUE INDEX "GamePhase_id_gameId_key" ON "GamePhase"("id", "gameId");

-- AddForeignKey
ALTER TABLE "GamePhase" ADD CONSTRAINT "GamePhase_eliminatedParticipantId_gameId_fkey" FOREIGN KEY ("eliminatedParticipantId", "gameId") REFERENCES "GameParticipant"("id", "gameId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NightAction" ADD CONSTRAINT "NightAction_phaseId_gameId_fkey" FOREIGN KEY ("phaseId", "gameId") REFERENCES "GamePhase"("id", "gameId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NightAction" ADD CONSTRAINT "NightAction_actorId_gameId_fkey" FOREIGN KEY ("actorId", "gameId") REFERENCES "GameParticipant"("id", "gameId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NightAction" ADD CONSTRAINT "NightAction_targetId_gameId_fkey" FOREIGN KEY ("targetId", "gameId") REFERENCES "GameParticipant"("id", "gameId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NightAction" ADD CONSTRAINT "NightAction_inspectedRoleCode_fkey" FOREIGN KEY ("inspectedRoleCode") REFERENCES "Role"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VillageVote" ADD CONSTRAINT "VillageVote_phaseId_gameId_fkey" FOREIGN KEY ("phaseId", "gameId") REFERENCES "GamePhase"("id", "gameId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VillageVote" ADD CONSTRAINT "VillageVote_actorId_gameId_fkey" FOREIGN KEY ("actorId", "gameId") REFERENCES "GameParticipant"("id", "gameId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VillageVote" ADD CONSTRAINT "VillageVote_targetId_gameId_fkey" FOREIGN KEY ("targetId", "gameId") REFERENCES "GameParticipant"("id", "gameId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Efficient scheduler scan; retain existing partial uniqueness indexes as well.
CREATE INDEX "GamePhase_pending_deadline_idx" ON "GamePhase"("deadline", "gameId") WHERE "resolvedAt" IS NULL;
ALTER TABLE "NightAction" ADD CONSTRAINT "NightAction_no_self_target" CHECK ("targetId" IS NULL OR "targetId" <> "actorId");
ALTER TABLE "VillageVote" ADD CONSTRAINT "VillageVote_no_self_target" CHECK ("targetId" IS NULL OR "targetId" <> "actorId");
ALTER TABLE "NightAction" ADD CONSTRAINT "NightAction_inspection_result_check" CHECK (
  ("kind" = 'WOLF_ATTACK' AND "inspectedRoleCode" IS NULL) OR
  ("kind" = 'SEER_INSPECT' AND (("targetId" IS NULL AND "inspectedRoleCode" IS NULL) OR ("targetId" IS NOT NULL AND "inspectedRoleCode" IS NOT NULL)))
);
