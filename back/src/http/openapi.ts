const healthSchema = {
  type: 'object', required: ['status', '_links'],
  properties: { status: { type: 'string' }, _links: { type: 'object' } },
};

export const openApiDocument = {
  openapi: '3.0.3',
  info: { title: 'Loup-Garou API', version: '0.1.0',
    description: 'Socle technique. Les fonctionnalités du jeu ne sont pas encore implémentées.' },
  paths: {
    '/api/health': { get: { summary: 'Vérifie que le serveur HTTP répond',
      responses: { '200': { description: 'Serveur actif',
        content: { 'application/hal+json': { schema: healthSchema } } } } } },
    '/api/ready': { get: { summary: 'Vérifie PostgreSQL et Redis',
      responses: {
        '200': { description: 'Dépendances disponibles', content: { 'application/hal+json': { schema: {
          ...healthSchema, properties: { ...healthSchema.properties, dependencies: { type: 'object',
            properties: { database: { type: 'boolean' }, redis: { type: 'boolean' } } } },
        } } } },
        '503': { description: 'Au moins une dépendance est indisponible' },
      } } },
  },
};
