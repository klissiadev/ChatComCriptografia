export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  dbFile: process.env.DB_FILE ?? './data/chat.db',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  jwtTtlSeconds: 7 * 24 * 3600,
};
export type Config = typeof config;
