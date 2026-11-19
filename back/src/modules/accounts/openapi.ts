const profile = {
  type: 'object', required: ['id', 'username', 'email', 'createdAt'],
  properties: { id: { type: 'string', format: 'uuid' }, username: { type: 'string' },
    email: { type: 'string', format: 'email' }, createdAt: { type: 'string', format: 'date-time' }, _links: { type: 'object' } },
};
const error = (description: string) => ({ description, content: { 'application/json': { schema: {
  type: 'object', properties: { code: { type: 'string' }, error: { type: 'string' } },
} } } });
const authenticated = [{ sessionCookie: [] }];
const mutation = [{ sessionCookie: [], csrfToken: [] }];
const origin = { name: 'Origin', in: 'header', required: true, schema: { type: 'string', format: 'uri' },
  description: 'Exact APP_ORIGIN, including for curl and server-side clients.' };
const email = { type: 'string', format: 'email', maxLength: 254 };
const failures = { '400': error('Invalid request'), '403': error('Invalid Origin or CSRF token'),
  '429': { ...error('Rate limit reached'), headers: { 'Retry-After': { schema: { type: 'integer' }, description: 'Seconds before retry' } } },
  '500': error('Unexpected internal failure'), '503': error('Service temporarily unavailable') };
const success = { description: 'Personal profile (never a password hash)',
  content: { 'application/hal+json': { schema: profile } } };
const loginSchema = { type: 'object', additionalProperties: false, required: ['email', 'password'],
  properties: { email, password: { type: 'string', minLength: 1, maxLength: 128, writeOnly: true } } };

export const accountComponents = {
  securitySchemes: {
    sessionCookie: { type: 'apiKey', in: 'cookie', name: 'loup.sid', description: 'Opaque signed HttpOnly session cookie; sent automatically with credentials: include.' },
    csrfToken: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token', description: 'Fetch /api/csrf first; replace token with the one returned by login.' },
  },
};

export const accountPaths = {
  '/api/csrf': { get: { summary: 'Initialize anonymous session and obtain CSRF token',
    description: 'Use credentials: include. Sets loup.sid; returns the CSRF token. Response is never cached.',
    responses: { '200': { description: 'Token ready', content: { 'application/json': { schema: {
      type: 'object', properties: { csrfToken: { type: 'string' } }, required: ['csrfToken'],
    } } } }, '401': error('Expired session; fetch a new token again'), ...failures } } },
  '/api/users': { post: { summary: 'Register without automatically signing in', security: mutation, parameters: [origin],
    requestBody: { required: true, content: { 'application/json': { schema: {
      ...loginSchema, required: ['username', 'email', 'password'], properties: { email,
        username: { type: 'string', minLength: 3, maxLength: 24, pattern: '^[A-Za-z0-9_]+$' },
        password: { type: 'string', minLength: 12, maxLength: 128, writeOnly: true },
      },
    } } } },
    responses: { '201': { ...success, headers: { Location: { schema: { type: 'string' }, description: '/api/users/{id}' } } },
      '409': error('Email or case-insensitive username already used'), '401': error('Expired session'), ...failures } } },
  '/api/sessions': { post: { summary: 'Sign in and rotate session identifier and CSRF token', security: mutation, parameters: [origin],
    requestBody: { required: true, content: { 'application/json': { schema: loginSchema } } },
    responses: { '201': { description: 'New session cookie saved; replace the CSRF token in your client',
      headers: { Location: { schema: { type: 'string' }, description: '/api/sessions/current' } },
      content: { 'application/hal+json': { schema: { type: 'object', properties: {
        user: profile, csrfToken: { type: 'string' }, _links: { type: 'object' },
      } } } } }, '401': error('Invalid email/password or expired anonymous session'), ...failures } } },
  '/api/me': { get: { summary: 'Read your own profile', security: authenticated,
    responses: { '200': success, '401': error('Authentication required or session expired'), '429': failures['429'], '503': failures['503'] } } },
  '/api/users/{userId}': { get: { summary: 'Read your own user resource only', security: authenticated,
    parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: { '200': success, '401': error('Authentication required'), '404': error('User is not the current user'), '429': failures['429'] } } },
  '/api/sessions/current': {
    get: { summary: 'Read session state without exposing its identifier', security: authenticated,
      responses: { '200': { description: 'Current authenticated session', content: { 'application/hal+json': { schema: {
        type: 'object', properties: { authenticated: { type: 'boolean' }, expiresAt: { type: 'string', format: 'date-time' }, _links: { type: 'object' } },
      } } } }, '401': error('Authentication required or expired session'), '429': failures['429'] } },
    delete: { summary: 'Revoke current session in Redis and clear its cookie', security: mutation, parameters: [origin],
      responses: { '204': { description: 'Session revoked' }, '401': error('Authentication required or expired session'), ...failures } },
  },
};
