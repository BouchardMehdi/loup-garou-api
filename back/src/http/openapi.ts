const healthSchema = {
  type: 'object', required: ['status', '_links'],
  properties: { status: { type: 'string' }, _links: { type: 'object' } },
};

export const openApiDocument = {
  openapi: '3.0.3',
  info: { title: 'Loup-Garou API', version: '0.1.0',
    description: 'Socle technique. Les fonctionnalit?s du jeu ne sont pas encore impl?ment?es.' },
  paths: {
    '/api/health': { get: { summary: 'V?rifie que le serveur HTTP r?pond',
      responses: { '200': { description: 'Serveur actif',
        content: { 'application/hal+json': { schema: healthSchema } } } } } },
    '/api/ready': { get: { summary: 'V?rifie PostgreSQL et Redis',
      responses: {
        '200': { description: 'D?pendances disponibles', content: { 'application/hal+json': { schema: {
          ...healthSchema, properties: { ...healthSchema.properties, dependencies: { type: 'object',
            properties: { database: { type: 'boolean' }, redis: { type: 'boolean' } } } },
        } } } },
        '503': { description: 'Au moins une d?pendance est indisponible' },
      } } },
  },
};
