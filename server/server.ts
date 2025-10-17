import express from 'express';
import cors from 'cors';

const app = express();
const ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

app.use(cors({
  origin: ORIGIN,
  credentials: true, // CookieやAuthorizationヘッダを許可するならtrue
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  exposedHeaders: ['Content-Length','X-Request-Id']
}));
// 明示的にpreflightを処理
app.options('*', cors({ origin: ORIGIN, credentials: true }));

app.get('/health', (_, res) => res.send('ok'));

app.listen(process.env.PORT ?? 8787, () => {
  console.log('API on', process.env.PORT ?? 8787);
});