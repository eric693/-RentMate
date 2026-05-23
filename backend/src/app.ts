import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import routes from './routes/index';
import { startReminderJobs } from './jobs/reminderCron';

export const prisma = new PrismaClient();

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

app.use('/api', routes);

app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT ?? 3001);

app.listen(PORT, () => {
  console.log(`RentMate API running on http://localhost:${PORT}`);
  startReminderJobs();
});

export default app;
