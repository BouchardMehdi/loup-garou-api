-- CreateEnum
CREATE TYPE "LobbyVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "LobbyStatus" AS ENUM ('WAITING', 'IN_GAME', 'FINISHED', 'CLOSED');

-- CreateTable
CREATE TABLE "Lobby" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "visibility" "LobbyVisibility" NOT NULL,
    "status" "LobbyStatus" NOT NULL DEFAULT 'WAITING',
    "capacity" INTEGER NOT NULL,
    "discussionDurationSeconds" INTEGER NOT NULL DEFAULT 180,
    "voteDurationSeconds" INTEGER NOT NULL DEFAULT 60,
    "nightDurationSeconds" INTEGER NOT NULL DEFAULT 60,
    "invitationHash" CHAR(64),
    "ownerId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lobby_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LobbyMembership" (
    "id" UUID NOT NULL,
    "lobbyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "LobbyMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lobby_visibility_status_createdAt_id_idx" ON "Lobby"("visibility", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "LobbyMembership_lobbyId_userId_leftAt_idx" ON "LobbyMembership"("lobbyId", "userId", "leftAt");

-- AddForeignKey
ALTER TABLE "Lobby" ADD CONSTRAINT "Lobby_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyMembership" ADD CONSTRAINT "LobbyMembership_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyMembership" ADD CONSTRAINT "LobbyMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Only one active membership per user/lobby; departed memberships retain their history.
CREATE UNIQUE INDEX "LobbyMembership_active_unique" ON "LobbyMembership"("lobbyId", "userId") WHERE "leftAt" IS NULL;

-- Business bounds also enforced for writes outside the HTTP adapter.
ALTER TABLE "Lobby" ADD CONSTRAINT "Lobby_capacity_check" CHECK ("capacity" BETWEEN 6 AND 12);
ALTER TABLE "Lobby" ADD CONSTRAINT "Lobby_durations_check" CHECK (
  "discussionDurationSeconds" BETWEEN 30 AND 300 AND
  "voteDurationSeconds" BETWEEN 30 AND 300 AND
  "nightDurationSeconds" BETWEEN 30 AND 300
);
ALTER TABLE "Lobby" ADD CONSTRAINT "Lobby_invitation_check" CHECK (
  ("visibility" = 'PRIVATE' AND "invitationHash" IS NOT NULL) OR
  ("visibility" = 'PUBLIC' AND "invitationHash" IS NULL)
);
