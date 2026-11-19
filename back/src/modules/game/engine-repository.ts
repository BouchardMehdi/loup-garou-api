import type {PrismaClient} from '../../generated/prisma/client.js';
import {gameInclude,mapGame} from './infrastructure.js';
import {EngineError,type EngineRepository} from './engine.js';

export function prismaEngine(prisma:PrismaClient):EngineRepository{
  return {
    dueGames:async(now,limit)=>(await prisma.gamePhase.findMany({where:{resolvedAt:null,deadline:{lte:now},game:{status:'IN_PROGRESS'}},select:{gameId:true},orderBy:[{deadline:'asc'},{id:'asc'}],take:limit})).map(p=>p.gameId),
    withLockedGame:async(id,work)=>prisma.$transaction(async tx=>{
      const rows=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "Game" WHERE id = ${id}::uuid FOR UPDATE`;
      if(!rows.length)throw new EngineError('GAME_NOT_FOUND');
      const read=async()=>mapGame(await tx.game.findUniqueOrThrow({where:{id},include:gameInclude}));
      const initial=await read();
      return work({game:initial,reload:read,
        addChoice:async input=>{
          const actor=initial.participants.find(p=>p.id===input.actorId)!;
          const target=input.targetId?initial.participants.find(p=>p.id===input.targetId)!:null;
          const data={gameId:id,phaseId:input.phaseId,actorId:input.actorId,targetId:input.targetId,createdAt:input.at};
          const row=input.kind==='VILLAGE_VOTE'?await tx.villageVote.create({data}):await tx.nightAction.create({data:{...data,kind:input.kind,inspectedRoleCode:input.inspectionRole}});
          return {id:row.id,phaseId:input.phaseId,userId:actor.userId,kind:input.kind,targetUserId:target?.userId??null,inspectionRole:input.inspectionRole,createdAt:input.at};
        },
        resolve:async resolution=>{
          const closed=await tx.gamePhase.updateMany({where:{id:resolution.phaseId,gameId:id,resolvedAt:null},data:{resolvedAt:resolution.at,eliminatedParticipantId:resolution.eliminatedId}});
          if(closed.count!==1)throw new Error('Phase resolution invariant failed');
          if(resolution.eliminatedId){
            const killed=await tx.gameParticipant.updateMany({where:{id:resolution.eliminatedId,gameId:id,status:'ALIVE'},data:{status:'DEAD',eliminatedAt:resolution.at}});
            if(killed.count!==1)throw new Error('Elimination invariant failed');
          }
          if(resolution.winner){
            await tx.game.update({where:{id},data:{status:'FINISHED',winner:resolution.winner,finishedAt:resolution.at}});
            await tx.lobby.update({where:{id:initial.lobbyId},data:{status:'FINISHED'}});
          }else if(resolution.next){await tx.gamePhase.create({data:{gameId:id,...resolution.next}});}
        },
      });
    },{isolationLevel:'ReadCommitted',timeout:10000}),
  };
}
