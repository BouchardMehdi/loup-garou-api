const ref=(name:string)=>({$ref:`#/components/schemas/${name}`});
const links={type:'object',additionalProperties:{type:'object',properties:{href:{type:'string'}}}};
const publicParticipant={type:'object',properties:{id:{type:'string',format:'uuid'},userId:{type:'string',format:'uuid'},username:{type:'string'},status:{type:'string',enum:['ALIVE','DEAD']},eliminatedAt:{type:'string',format:'date-time',nullable:true},role:{type:'string',enum:['VILLAGER','WEREWOLF','SEER'],description:'Present only after FINISHED.'},team:{type:'string',enum:['VILLAGE','WEREWOLVES'],description:'Present only after FINISHED.'}}};
export const gameSchemas={
  ChoiceInput:{type:'object',additionalProperties:false,required:['targetUserId'],properties:{targetUserId:{type:'string',format:'uuid',nullable:true,description:'Another living participant userId, or null to abstain. Choice is final.'}}},
  PersonalChoice:{type:'object',properties:{id:{type:'string',format:'uuid'},gameId:{type:'string',format:'uuid'},phaseId:{type:'string',format:'uuid'},kind:{type:'string',enum:['WOLF_ATTACK','SEER_INSPECT','VILLAGE_VOTE']},targetUserId:{type:'string',format:'uuid',nullable:true},submittedAt:{type:'string',format:'date-time'},inspection:{type:'object',nullable:true,properties:{targetUserId:{type:'string',format:'uuid'},role:{type:'string',enum:['VILLAGER','WEREWOLF','SEER']}}},_links:links}},
  Game:{type:'object',properties:{id:{type:'string',format:'uuid'},lobbyId:{type:'string',format:'uuid'},status:{type:'string',enum:['IN_PROGRESS','FINISHED']},
    startedAt:{type:'string',format:'date-time'},finishedAt:{type:'string',format:'date-time',nullable:true},winner:{type:'string',enum:['VILLAGE','WEREWOLVES'],nullable:true},
    discussionDurationSeconds:{type:'integer'},voteDurationSeconds:{type:'integer'},nightDurationSeconds:{type:'integer'},
    phase:{type:'object',nullable:true,properties:{id:{type:'string',format:'uuid'},type:{type:'string',enum:['NIGHT','DAY_DISCUSSION','DAY_VOTE']},cycle:{type:'integer'},startedAt:{type:'string',format:'date-time'},deadline:{type:'string',format:'date-time'}}},
    lastResolution:{type:'object',nullable:true,properties:{phaseId:{type:'string',format:'uuid'},type:{type:'string',enum:['NIGHT','DAY_DISCUSSION','DAY_VOTE']},cycle:{type:'integer'},resolvedAt:{type:'string',format:'date-time'},eliminatedUserId:{type:'string',format:'uuid',nullable:true}}},
    participants:{type:'array',items:publicParticipant},_links:links}},
  PersonalParticipant:{type:'object',properties:{id:{type:'string',format:'uuid'},gameId:{type:'string',format:'uuid'},userId:{type:'string',format:'uuid'},username:{type:'string'},
    role:{type:'string',enum:['VILLAGER','WEREWOLF','SEER']},team:{type:'string',enum:['VILLAGE','WEREWOLVES']},status:{type:'string',enum:['ALIVE','DEAD']},
    currentChoice:{type:'object',allOf:[ref('PersonalChoice')],nullable:true,description:'Own final choice for the open phase, or null.'},
    inspections:{type:'array',description:'Only the seer receives their own persisted inspection history, including after elimination.',items:{type:'object',properties:{phaseId:{type:'string',format:'uuid'},targetUserId:{type:'string',format:'uuid'},role:{type:'string',enum:['VILLAGER','WEREWOLF','SEER']},createdAt:{type:'string',format:'date-time'}}}},
    teammates:{type:'array',description:'Other living wolves, only for a living wolf; otherwise empty.',items:{type:'object',properties:{id:{type:'string',format:'uuid'},userId:{type:'string',format:'uuid'},username:{type:'string'},status:{type:'string',enum:['ALIVE']}}}},_links:links}},
};
const errors={
  '400':{description:'Invalid UUID or nonempty start body'},'401':{description:'Authentication required'},
  '403':{description:'Invalid Origin/CSRF token, or a lobby member other than owner attempting start'},
  '404':{description:'Game/lobby absent or not accessible to this user'},
  '409':{description:'Lobby not waiting, game already started or player count outside 6–12/capacity'},
  '429':{description:'Request limit reached',headers:{'Retry-After':{schema:{type:'integer'}}}},'500':{description:'Internal server error'},'503':{description:'Limiter unavailable'},
};
const response=(name:string)=>({description:name,content:{'application/hal+json':{schema:ref(name)}}});
const gameId={name:'gameId',in:'path',required:true,schema:{type:'string',format:'uuid'}};
const baseGamePaths={
  '/api/lobbies/{lobbyId}/games':{post:{summary:'Owner starts a single game with a frozen roster and random secret roles',
    description:'First NIGHT and deadline are persisted. Server resolves night/vote when all expected living actors submit or at deadline. Discussion lasts its full duration. Roles remain secret until FINISHED.',
    security:[{sessionCookie:[],csrfToken:[]}],parameters:[{name:'lobbyId',in:'path',required:true,schema:{type:'string',format:'uuid'}},
      {name:'Origin',in:'header',required:true,schema:{type:'string'},description:'Exact APP_ORIGIN'}],
    requestBody:{required:false,content:{'application/json':{schema:{type:'object',additionalProperties:false}}}},
    responses:{'201':{...response('Game'),headers:{Location:{schema:{type:'string'},description:'/api/games/{id}'}}},...errors}}},
  '/api/games/{gameId}':{get:{summary:'Participant reads phase, deadline, last resolution and living players; roles revealed only after FINISHED',security:[{sessionCookie:[]}],parameters:[gameId],responses:{'200':response('Game'),...errors}}},
  '/api/games/{gameId}/participants/me':{get:{summary:'Read your role, authorized wolf teammates, current choice and private inspections',security:[{sessionCookie:[]}],parameters:[gameId],responses:{'200':response('PersonalParticipant'),...errors}}},
};

const phaseId={name:'phaseId',in:'path',required:true,schema:{type:'string',format:'uuid'}};
const choiceErrors={...errors,
  '400':{description:'VALIDATION_ERROR (UUID/body) or TARGET_FORBIDDEN (self, dead or wolf teammate)'},
  '403':{description:'Invalid Origin/CSRF, PLAYER_DEAD or ROLE_FORBIDDEN'},
  '404':{description:'GAME_NOT_FOUND, TARGET_NOT_FOUND or CHOICE_NOT_FOUND; outsiders cannot read a game or another player choice'},
  '409':{description:'GAME_FINISHED, PHASE_CLOSED (including exact deadline), WRONG_PHASE or CHOICE_ALREADY_SUBMITTED'},
};
const choicePaths=Object.fromEntries((['night-actions','votes'] as const).flatMap(resource=>{
  const path=`/api/games/{gameId}/phases/{phaseId}/${resource}`;
  return [[path,{post:{summary:resource==='votes'?'Submit your final village vote or abstention':'Submit your final wolf attack or private seer inspection, or abstain',
    description:'Only living authorized participants in the current phase before its deadline. Kind is inferred from role; peers cannot read ballots. A lost response can be recovered with GET .../me. Last expected submission may close the phase immediately.',
    security:[{sessionCookie:[],csrfToken:[]}],parameters:[gameId,phaseId,{name:'Origin',in:'header',required:true,schema:{type:'string'},description:'Exact APP_ORIGIN'}],
    requestBody:{required:true,content:{'application/json':{schema:ref('ChoiceInput')}}},
    responses:{'201':{...response('PersonalChoice'),headers:{Location:{schema:{type:'string'},description:`${path}/me`}}},...choiceErrors}}}],
    [`${path}/me`,{get:{summary:'Read only your own persisted choice for this phase, including past phases',security:[{sessionCookie:[]}],parameters:[gameId,phaseId],responses:{'200':response('PersonalChoice'),...choiceErrors}}}]];
}));
export const gamePaths={...baseGamePaths,...choicePaths};
