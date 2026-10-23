import { config } from './config';
import { createServer } from './server';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required in production');
}

const { httpServer, close } = createServer(config);
httpServer.listen(config.port, () => console.log(`chat backend listening on :${config.port}`));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => { await close(); process.exit(0); });
}
