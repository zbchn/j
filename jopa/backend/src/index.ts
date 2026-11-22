import express from 'express';
import http from 'http';
import cors from 'cors';
import { CONFIG } from './config';
import { initDatabase } from './db';
import { authRouter } from './routes/auth.routes';
import { chatRouter } from './routes/chat.routes';
import { adminRouter } from './routes/admin.routes';
import { initSocketServer } from './socket/socket.handler';

async function bootstrap() {
  initDatabase();

  const app = express();
  app.set('trust proxy', true);
  app.use(cors({ origin: '*' }));
  app.use(express.json({ limit: '500mb' }));
  app.use(express.urlencoded({ extended: true, limit: '500mb' }));

  app.use(
    '/uploads',
    express.static(CONFIG.UPLOADS_DIR, {
      setHeaders: (res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Accept-Ranges', 'bytes');
      }
    })
  );

  app.use('/api/auth', authRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/admin', adminRouter);

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'jessenger',
      domain: CONFIG.DOMAIN,
      timestamp: new Date().toISOString()
    });
  });

  const httpServer = http.createServer(app);
  initSocketServer(httpServer);

  httpServer.listen(CONFIG.PORT, '0.0.0.0', () => {
    console.log('==============================================================');
    console.log(`✨ сервер jessenger запущен на порту: ${CONFIG.PORT}`);
    console.log(`🌐 домен: ${CONFIG.DOMAIN}`);
    console.log('==============================================================');
  });
}

bootstrap().catch((err) => {
  console.error('критическая ошибка запуска jessenger:', err);
  process.exit(1);
});
