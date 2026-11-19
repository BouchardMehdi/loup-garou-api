-- CreateEnum
CREATE TYPE "GameTeam" AS ENUM ('VILLAGE', 'WEREWOLVES');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('IN_PROGRESS', 'FINISHED');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('ALIVE', 'DEAD');

-- CreateEnum
CREATE TYPE "PhaseType" AS ENUM ('NIGHT', 'DAY_DISCUSSION', 'DAY_VOTE');

-- CreateTable
CREATE TABLE "Role" (
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "team" "GameTeam" NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" UUID NOT NULL,
    "lobbyId" UUID NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "winner" "GameTeam",
    "discussionDurationSeconds" INTEGER NOT NULL,
    "voteDurationSeconds" INTEGER NOT NULL,
    "nightDurationSeconds" INTEGER NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameParticipant" (
    "id" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "usernameSnapshot" VARCHAR(24) NOT NULL,
    "roleCode" VARCHAR(32) NOT NULL,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'ALIVE',
    "eliminatedAt" TIMESTAMP(3),

    CONSTRAINT "GameParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamePhase" (
    "id" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "type" "PhaseType" NOT NULL,
    "cycle" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "GamePhase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Game_lobbyId_key" ON "Game"("lobbyId");

-- CreateIndex
CREATE UNIQUE INDEX "GameParticipant_gameId_userId_key" ON "GameParticipant"("gameId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "GamePhase_gameId_cycle_type_key" ON "GamePhase"("gameId", "cycle", "type");

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameParticipant" ADD CONSTRAINT "GameParticipant_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameParticipant" ADD CONSTRAINT "GameParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameParticipant" ADD CONSTRAINT "GameParticipant_roleCode_fkey" FOREIGN KEY ("roleCode") REFERENCES "Role"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamePhase" ADD CONSTRAINT "GamePhase_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Initial server-controlled role catalog. No client-supplied role configuration.
INSERT INTO "Role" ("code", "name", "team") VALUES
  ('VILLAGER', 'Villageois', 'VILLAGE'),
  ('WEREWOLF', 'Loup-garou', 'WEREWOLVES'),
  ('SEER', 'Voyante', 'VILLAGE');

-- One unresolved phase per game; preserve this partial index in future migrations.
CREATE UNIQUE INDEX "GamePhase_one_open_per_game" ON "GamePhase"("gameId") WHERE "resolvedAt" IS NULL;
ALTER TABLE "GamePhase" ADD CONSTRAINT "GamePhase_cycle_check" CHECK ("cycle" >= 1);
ALTER TABLE "GamePhase" ADD CONSTRAINT "GamePhase_deadline_check" CHECK ("deadline" > "startedAt");
ALTER TABLE "Game" ADD CONSTRAINT "Game_durations_check" CHECK (
  "discussionDurationSeconds" BETWEEN 30 AND 300 AND
  "voteDurationSeconds" BETWEEN 30 AND 300 AND
  "nightDurationSeconds" BETWEEN 30 AND 300
);
