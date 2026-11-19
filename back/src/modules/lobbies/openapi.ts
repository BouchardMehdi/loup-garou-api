const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const links = { type: 'object', additionalProperties: { type: 'object', properties: { href: { type: 'string' } }, required: ['href'] } };
const duration = { type: 'integer', minimum: 30, maximum: 300 };
const summaryProperties = {
  gameId: { type: 'string', format: 'uuid', nullable: true },
  id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, visibility: { type: 'string', enum: ['PUBLIC','PRIVATE'] },
  status: { type: 'string', enum: ['WAITING','IN_GAME','FINISHED','CLOSED'] }, capacity: { type: 'integer', minimum: 6, maximum: 12 },
  memberCount: { type: 'integer' }, owner: { type: 'object', properties: { id: { type: 'string',format: 'uuid' },username: { type: 'string' } } },
  discussionDurationSeconds: duration, voteDurationSeconds: duration, nightDurationSeconds: duration,
  createdAt: { type: 'string', format: 'date-time' }, _links: links,
};
const member = { type: 'object', properties: { userId: { type: 'string', format: 'uuid' }, username: { type: 'string' }, joinedAt: { type: 'string',format: 'date-time' } } };
export const lobbySchemas = {
  LobbySummary: { type: 'object', properties: summaryProperties },
  LobbyDetail: { type: 'object', properties: { ...summaryProperties, members: { type: 'array',items: member } } },
  CreatedLobby: { allOf: [ref('LobbyDetail'), { type: 'object', properties: { invitationCode: { type: 'string', pattern: '^[A-F0-9]{24}$',
    description: 'Private creation response only; never returned again.' } } }] },
  LobbyMembership: { type: 'object', properties: { ...member.properties, id: { type: 'string',format: 'uuid' },
    lobbyId: { type: 'string',format: 'uuid' },_links: links } },
  LobbyPage: { type: 'object', properties: { page: { type: 'integer' },pageSize: { type: 'integer' },total: { type: 'integer' },
    _embedded: { type: 'object',properties: { lobbies: { type: 'array',items: ref('LobbySummary') } } },_links: links } },
};
const auth = [{ sessionCookie: [] }]; const csrf = [{ sessionCookie: [], csrfToken: [] }];
const identifier = { name: 'lobbyId',in: 'path',required: true,schema: { type: 'string',format: 'uuid' } };
const origin = { name: 'Origin',in: 'header',required: true,schema: { type: 'string' }, description: 'Exact APP_ORIGIN; automatically sent by browsers on mutations.' };
const error = (description: string) => ({ description,content: { 'application/json': { schema: { type: 'object',properties: { code: { type: 'string' },error: { type: 'string' } } } } } });
const errors = { '400': error('Invalid input, identifier or pagination'), '401': error('Authentication required or expired session'),
  '403': error('Invalid CSRF token or Origin'), '404': error('Lobby/membership not found, private access denied or invalid invitation'),
  '409': error('Already a member, lobby full, or lobby not waiting'),
  '429': { ...error('Rate limit exceeded'),headers: { 'Retry-After': { schema: { type: 'integer' } } } },
  '500': error('Internal server error'),'503': error('Request limiter unavailable') };
const response = (name: string) => ({ description: name,content: { 'application/hal+json': { schema: ref(name) } } });
const created = (name: string) => ({ ...response(name),headers: { Location: { schema: { type: 'string' } } } });

export const lobbyPaths = {
  '/api/lobbies': {
    get: { summary: 'List public waiting lobbies, including full ones',security: auth,
      parameters: [{ name: 'page',in: 'query',schema: { type: 'integer',minimum: 1,default: 1 } },
        { name: 'pageSize',in: 'query',schema: { type: 'integer',minimum: 1,maximum: 100,default: 25 } }],
      responses: { '200': response('LobbyPage'),...errors } },
    post: { summary: 'Create a lobby and join as owner',security: csrf,parameters: [origin],
      requestBody: { required: true,content: { 'application/json': { schema: {
        type: 'object',additionalProperties: false,required: ['name'],properties: {
          name: { type: 'string',minLength: 3,maxLength: 80 },visibility: { type: 'string',enum: ['PUBLIC','PRIVATE'],default: 'PUBLIC' },
          capacity: { type: 'integer',minimum: 6,maximum: 12,default: 12 },discussionDurationSeconds: { ...duration,default: 180 },
          voteDurationSeconds: { ...duration,default: 60 },nightDurationSeconds: { ...duration,default: 60 },
        },
      } } } },responses: { '201': created('CreatedLobby'),...errors } },
  },
  '/api/lobbies/{lobbyId}': { get: { summary: 'Read a public waiting lobby or a lobby you belong to',
    security: auth,parameters: [identifier],responses: { '200': response('LobbyDetail'),...errors } } },
  '/api/lobbies/{lobbyId}/memberships': { post: { summary: 'Join a waiting lobby; private ones require the invitation',
    security: csrf,parameters: [identifier,origin],requestBody: { required: false,content: { 'application/json': { schema: {
      type: 'object',additionalProperties: false,properties: { invitationCode: { type: 'string',pattern: '^[A-Fa-f0-9]{24}$' } },
    } } } },responses: { '201': created('LobbyMembership'),...errors } } },
  '/api/lobbies/{lobbyId}/memberships/me': {
    get: { summary: 'Read your current active membership',security: auth,parameters: [identifier],responses: { '200': response('LobbyMembership'),...errors } },
    delete: { summary: 'Leave before launch; transfer ownership or close when empty',security: csrf,parameters: [identifier,origin],
      responses: { '204': { description: 'Membership ended; historical record retained' },...errors } },
  },
};
