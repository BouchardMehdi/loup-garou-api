export function databaseUrl(env: NodeJS.ProcessEnv): string {
  const url = new URL('postgresql://localhost');
  url.hostname = env.POSTGRES_HOST ?? 'db';
  url.port = env.POSTGRES_PORT ?? '5432';
  url.username = encodeURIComponent(env.POSTGRES_USER ?? 'loup_garou');
  url.password = encodeURIComponent(env.POSTGRES_PASSWORD ?? '');
  url.pathname = `/${encodeURIComponent(env.POSTGRES_DB ?? 'loup_garou')}`;
  return url.toString();
}
