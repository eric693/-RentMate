"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UPLOAD_DIR = exports.prisma = void 0;
require("dotenv/config");
// 讓 async 路由丟出的錯誤交給下方錯誤處理，而不是讓請求一直卡住沒有回應
require("express-async-errors");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const cors_1 = __importDefault(require("cors"));
const client_2 = require("@prisma/client");
const index_1 = __importDefault(require("./routes/index"));
const notificationScheduler_1 = require("./services/notificationScheduler");
exports.prisma = new client_2.PrismaClient();
// 上傳目錄（維修照片等）
exports.UPLOAD_DIR = path_1.default.resolve(__dirname, '../uploads');
fs_1.default.mkdirSync(path_1.default.join(exports.UPLOAD_DIR, 'maintenance'), { recursive: true });
const app = (0, express_1.default)();
app.use((0, cors_1.default)({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    credentials: true,
}));
// 影像以 base64 上傳，放寬 body 上限
app.use(express_1.default.json({ limit: '15mb' }));
// 靜態服務上傳檔案
app.use('/uploads', express_1.default.static(exports.UPLOAD_DIR));
app.use('/api', index_1.default);
app.get('/health', (_req, res) => res.json({ ok: true }));
// 統一錯誤處理：資料格式錯誤回 400，其餘回 500，都用 JSON 讓前端顯示訊息
app.use((err, req, res, _next) => {
    console.error(`[${req.method} ${req.originalUrl}]`, err);
    if (res.headersSent)
        return;
    if (err instanceof client_1.Prisma.PrismaClientValidationError) {
        res.status(400).json({ error: '資料格式不正確，請檢查欄位後再試一次' });
        return;
    }
    if (err instanceof client_1.Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') {
            res.status(409).json({ error: '資料重複，已有相同的紀錄' });
            return;
        }
        if (err.code === 'P2025') {
            res.status(404).json({ error: '找不到資料' });
            return;
        }
        if (err.code === 'P2003') {
            res.status(409).json({ error: '這筆資料仍被其他資料使用，無法刪除' });
            return;
        }
    }
    res.status(500).json({ error: '伺服器發生錯誤，請稍後再試' });
});
const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
    console.log(`RentMate API running on http://localhost:${PORT}`);
    (0, notificationScheduler_1.startScheduler)();
});
exports.default = app;
