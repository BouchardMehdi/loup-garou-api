const ref=(name:string)=>({$ref:`#/components/schemas/${name}`});
const links={type:'object',additionalProperties:{type:'object',properties:{href:{type:'string'}}}};
const publicParticipant={type:'object',properties:{id:{type:'string',format:'uuid'},userId:{type:'string',format:'uuid'},username:{type:'string'},status:{type:'string',enum:['ALIVE','DEAD']},eliminatedAt:{type:'string',format:'date-time',nullable:true}}};
export const gameSchemas={
  Game:{type:'object',properties:{id:{type:'string',format:'uuid'},lobbyId:{type:'string',format:'uuid'},status:{type:'string',enum:['IN_PROGRESS','FINISHED']},
    startedAt:{type:'string',format:'date-time'},finishedAt:{type:'string',format:'date-time',nullable:true},winner:{type:'string',enum:['VILLAGE','WEREWOLVES'],nullable:true},
    discussionDurationSeconds:{type:'integer'},voteDurationSeconds:{type:'integer'},nightDurationSeconds:{type:'integer'},
    phase:{type:'object',nullable:true,properties:{id:{type:'string',format:'uuid'},type:{type:'string',enum:['NIGHT','DAY_DISCUSSION','DAY_VOTE']},cycle:{type:'integer'},startedAt:{type:'string',format:'date-time'},deadline:{type:'string',format:'date-time'}}},
    participants:{type:'array',items:publicParticipant},_links:links}},
  PersonalParticipant:{type:'object',properties:{id:{type:'string',format:'uuid'},gameId:{type:'string',format:'uuid'},userId:{type:'string',format:'uuid'},username:{type:'string'},
    role:{type:'string',enum:['VILLAGER','WEREWOLF','SEER']},team:{type:'string',enum:['VILLAGE','WEREWOLVES']},status:{type:'string',enum:['ALIVE','DEAD']},
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
export const gamePaths={
  '/api/lobbies/{lobbyId}/games':{post:{summary:'Owner starts a single game with a frozen roster and random secret roles',
    description:'First NIGHT and deadline are persisted. Automatic progression and night/vote actions are not yet implemented.',
    security:[{sessionCookie:[],csrfToken:[]}],parameters:[{name:'lobbyId',in:'path',required:true,schema:{type:'string',format:'uuid'}},
      {name:'Origin',in:'header',required:true,schema:{type:'string'},description:'Exact APP_ORIGIN'}],
    requestBody:{required:false,content:{'application/json':{schema:{type:'object',additionalProperties:false}}}},
    responses:{'201':{...response('Game'),headers:{Location:{schema:{type:'string'},description:'/api/games/{id}'}}},...errors}}},
  '/api/games/{gameId}':{get:{summary:'Participant reads game state without roles or camps of other players',security:[{sessionCookie:[]}],parameters:[gameId],responses:{'200':response('Game'),...errors}}},
  '/api/games/{gameId}/participants/me':{get:{summary:'Read only your role, camp and authorized wolf teammates',security:[{sessionCookie:[]}],parameters:[gameId],responses:{'200':response('PersonalParticipant'),...errors}}},
};
