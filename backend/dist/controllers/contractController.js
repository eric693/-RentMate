"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getContracts = getContracts;
exports.createContract = createContract;
exports.updateContract = updateContract;
exports.generateSignInvite = generateSignInvite;
exports.getContractByToken = getContractByToken;
exports.signContractByToken = signContractByToken;
const app_1 = require("../app");
const rentService_1 = require("../services/rentService");
const lineService_1 = require("../services/lineService");
const crypto_1 = __importDefault(require("crypto"));
async function getContracts(req, res) {
    const userId = req.userId;
    const { status } = req.query;
    const properties = await app_1.prisma.property.findMany({ where: { userId } });
    const propertyIds = properties.map((p) => p.id);
    const units = await app_1.prisma.unit.findMany({ where: { propertyId: { in: propertyIds } } });
    const unitIds = units.map((u) => u.id);
    const contracts = await app_1.prisma.contract.findMany({
        where: {
            unitId: { in: unitIds },
            ...(status ? { status: status } : {}),
        },
        include: {
            unit: { include: { property: true } },
            tenant: true,
            rentRecords: { orderBy: { dueDate: 'desc' }, take: 1 },
        },
        orderBy: { endDate: 'asc' },
    });
    res.json(contracts);
}
async function createContract(req, res) {
    const { unitId, tenantId, startDate, endDate, monthlyRent, depositAmount, depositPaid, rentDueDay, notes } = req.body;
    if (!unitId || !tenantId || !startDate || !endDate || !monthlyRent) {
        res.status(400).json({ error: '請填寫所有必填欄位' });
        return;
    }
    const unit = await app_1.prisma.unit.findFirst({ where: { id: unitId }, include: { property: true } });
    if (!unit || unit.property.userId !== req.userId) {
        res.status(404).json({ error: '找不到房間' });
        return;
    }
    const contract = await app_1.prisma.contract.create({
        data: {
            unitId,
            tenantId,
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            monthlyRent,
            depositAmount: depositAmount ?? monthlyRent * 2,
            depositPaid: depositPaid ?? false,
            rentDueDay: rentDueDay ?? 5,
            notes,
        },
    });
    await app_1.prisma.unit.update({ where: { id: unitId }, data: { status: 'OCCUPIED' } });
    await (0, rentService_1.generateMonthlyRentRecords)(contract.id);
    res.status(201).json(contract);
}
async function updateContract(req, res) {
    const { id } = req.params;
    const contract = await app_1.prisma.contract.findFirst({
        where: { id },
        include: { unit: { include: { property: true } } },
    });
    if (!contract || contract.unit.property.userId !== req.userId) {
        res.status(404).json({ error: '找不到合約' });
        return;
    }
    const { endDate, status, notes, depositPaid } = req.body;
    const updated = await app_1.prisma.contract.update({
        where: { id },
        data: { endDate: endDate ? new Date(endDate) : undefined, status, notes, depositPaid },
    });
    if (status === 'TERMINATED' || status === 'EXPIRED') {
        await app_1.prisma.unit.update({ where: { id: contract.unitId }, data: { status: 'VACANT' } });
    }
    res.json(updated);
}
async function generateSignInvite(req, res) {
    const { id } = req.params;
    const contract = await app_1.prisma.contract.findFirst({
        where: { id },
        include: {
            unit: { include: { property: true } },
            tenant: true,
        },
    });
    if (!contract || contract.unit.property.userId !== req.userId) {
        res.status(404).json({ error: '找不到合約' });
        return;
    }
    if (contract.signedAt) {
        res.status(400).json({ error: '合約已完成簽署' });
        return;
    }
    const token = crypto_1.default.randomBytes(24).toString('hex');
    await app_1.prisma.contract.update({ where: { id }, data: { signToken: token } });
    const baseUrl = process.env.APP_URL ?? 'http://localhost:6000';
    const signUrl = `${baseUrl}/sign/${token}`;
    const tenant = contract.tenant;
    const unitNum = contract.unit.unitNumber;
    const propName = contract.unit.property.name;
    let sent = false;
    if (tenant.lineUserId) {
        const text = `📄 合約簽署邀請\n\n您好 ${tenant.name}，\n房東邀請您簽署 ${propName} ${unitNum} 的租賃合約。\n\n📋 合約期間：${new Date(contract.startDate).toLocaleDateString('zh-TW')} ～ ${new Date(contract.endDate).toLocaleDateString('zh-TW')}\n💰 月租金：NT$${Number(contract.monthlyRent).toLocaleString()}\n\n請點擊以下連結完成電子簽署：\n${signUrl}\n\n⚠️ 連結僅供本次簽署使用，請勿轉發。`;
        sent = await (0, lineService_1.sendTenantMessage)(tenant.id, text);
    }
    res.json({ token, signUrl, sent });
}
async function getContractByToken(req, res) {
    const { token } = req.params;
    const contract = await app_1.prisma.contract.findUnique({
        where: { signToken: token },
        include: {
            unit: { include: { property: true } },
            tenant: true,
        },
    });
    if (!contract) {
        res.status(404).json({ error: '連結無效或已過期' });
        return;
    }
    res.json({
        id: contract.id,
        signedAt: contract.signedAt,
        signerName: contract.signerName,
        startDate: contract.startDate,
        endDate: contract.endDate,
        monthlyRent: contract.monthlyRent,
        depositAmount: contract.depositAmount,
        rentDueDay: contract.rentDueDay,
        notes: contract.notes,
        unit: { unitNumber: contract.unit.unitNumber },
        property: { name: contract.unit.property.name, address: contract.unit.property.address },
        tenant: { name: contract.tenant.name },
    });
}
async function signContractByToken(req, res) {
    const { token } = req.params;
    const { signerName, agreed } = req.body;
    if (!agreed || !signerName) {
        res.status(400).json({ error: '請填寫姓名並確認同意' });
        return;
    }
    const contract = await app_1.prisma.contract.findUnique({ where: { signToken: token } });
    if (!contract) {
        res.status(404).json({ error: '連結無效' });
        return;
    }
    if (contract.signedAt) {
        res.status(400).json({ error: '合約已完成簽署' });
        return;
    }
    const updated = await app_1.prisma.contract.update({
        where: { id: contract.id },
        data: { signedAt: new Date(), signerName },
    });
    res.json({ signedAt: updated.signedAt, message: '簽署完成，感謝您！' });
}
