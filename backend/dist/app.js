"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const client_1 = require("@prisma/client");
const index_1 = __importDefault(require("./routes/index"));
const reminderCron_1 = require("./jobs/reminderCron");
exports.prisma = new client_1.PrismaClient();
const app = (0, express_1.default)();
app.use((0, cors_1.default)({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    credentials: true,
}));
app.use(express_1.default.json());
app.use('/api', index_1.default);
app.get('/health', (_req, res) => res.json({ ok: true }));
const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
    console.log(`RentMate API running on http://localhost:${PORT}`);
    (0, reminderCron_1.startReminderJobs)();
});
exports.default = app;
