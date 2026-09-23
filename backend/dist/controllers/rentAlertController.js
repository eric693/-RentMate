"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTodayRentAlerts = getTodayRentAlerts;
exports.getRentUtilityStats = getRentUtilityStats;
const app_1 = require("../app");
const TZ = 'Asia/Taipei';
/** 台北時間的年、月、日 */
function taipeiYMD(dt = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(dt);
    const get = (t) => Number(parts.find((p) => p.type === t).value);
    return { year: get('year'), month: get('month'), day: get('day') };
}
/** 繳租日超過當月天數時（例如 31 號遇到 2 月），以當月最後一天為準 */
function effectiveDueDay(rentDueDay, year, month) {
    const lastDay = new Date(year, month, 0).getDate();
    return Math.min(Math.max(rentDueDay, 1), lastDay);
}
async function getUserUnits(userId) {
    return app_1.prisma.unit.findMany({
        where: { property: { userId } },
        include: { property: true },
    });
}
/**
 * 今日收租鈴聲：回傳今天是繳租日、且本月租金尚未收齊的房間，
 * 另附已過繳租日仍未收的房間，給前端響鈴與清單顯示。
 */
async function getTodayRentAlerts(req, res) {
    const today = taipeiYMD();
    const contracts = await app_1.prisma.contract.findMany({
        where: { status: 'ACTIVE', unit: { property: { userId: req.userId } } },
        include: {
            tenant: true,
            unit: { include: { property: true } },
            rentRecords: { where: { year: today.year, month: today.month } },
        },
    });
    const dueToday = [];
    for (const c of contracts) {
        if (effectiveDueDay(c.rentDueDay, today.year, today.month) !== today.day)
            continue;
        const record = c.rentRecords[0];
        if (record?.status === 'PAID')
            continue;
        dueToday.push({
            contractId: c.id,
            rentRecordId: record?.id ?? null,
            propertyName: c.unit.property.name,
            unitNumber: c.unit.unitNumber,
            tenantName: c.tenant.name,
            tenantPhone: c.tenant.phone,
            amount: Number(record?.amount ?? c.monthlyRent),
            paidAmount: Number(record?.paidAmount ?? 0),
            rentDueDay: c.rentDueDay,
        });
    }
    const startOfToday = new Date(`${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}T00:00:00+08:00`);
    const overdueRecords = await app_1.prisma.rentRecord.findMany({
        where: {
            status: { in: ['PENDING', 'OVERDUE', 'PARTIAL'] },
            dueDate: { lt: startOfToday },
            contract: { status: 'ACTIVE', unit: { property: { userId: req.userId } } },
        },
        include: { contract: { include: { tenant: true, unit: { include: { property: true } } } } },
        orderBy: { dueDate: 'asc' },
    });
    const overdue = overdueRecords.map((r) => ({
        rentRecordId: r.id,
        propertyName: r.contract.unit.property.name,
        unitNumber: r.contract.unit.unitNumber,
        tenantName: r.contract.tenant.name,
        tenantPhone: r.contract.tenant.phone,
        amount: Number(r.amount),
        paidAmount: Number(r.paidAmount ?? 0),
        dueDate: r.dueDate,
        year: r.year,
        month: r.month,
    }));
    // 本月各房間繳租日一覽（供「每間房的繳租日」清單）
    const schedule = contracts
        .map((c) => {
        const record = c.rentRecords[0];
        return {
            contractId: c.id,
            propertyName: c.unit.property.name,
            unitNumber: c.unit.unitNumber,
            tenantName: c.tenant.name,
            amount: Number(record?.amount ?? c.monthlyRent),
            dueDay: effectiveDueDay(c.rentDueDay, today.year, today.month),
            status: record?.status ?? 'NOT_GENERATED',
        };
    })
        .sort((a, b) => a.dueDay - b.dueDay || a.unitNumber.localeCompare(b.unitNumber));
    res.json({
        date: `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`,
        dueToday,
        overdue,
        schedule,
    });
}
/** 年度房租統計＋電費統計 */
async function getRentUtilityStats(req, res) {
    const year = Number(req.query.year) || taipeiYMD().year;
    const userId = req.userId;
    const units = await getUserUnits(userId);
    const unitMap = new Map(units.map((u) => [u.id, u]));
    const months = Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        rentDue: 0,
        rentCollected: 0,
        unpaidCount: 0,
        electricityBill: 0, // 台電總單（水電帳單模組，依計費期迄日歸月）
        electricityExpense: 0, // 支出記錄中的電費
        prepaidUsage: 0, // 預付電表扣款
        prepaidKwh: 0,
        prepaidTopup: 0,
    }));
    const unitRows = new Map();
    const rowOf = (unitId) => {
        let row = unitRows.get(unitId);
        if (!row) {
            const u = unitMap.get(unitId);
            row = {
                unitId, propertyName: u?.property.name ?? '', unitNumber: u?.unitNumber ?? '',
                rentDue: 0, rentCollected: 0, unpaidCount: 0,
                electricityAllocated: 0, prepaidUsage: 0, prepaidKwh: 0,
            };
            unitRows.set(unitId, row);
        }
        return row;
    };
    units.forEach((u) => rowOf(u.id));
    // 房租
    const rentRecords = await app_1.prisma.rentRecord.findMany({
        where: { year, contract: { unit: { property: { userId } } } },
        include: { contract: { select: { unitId: true } } },
    });
    for (const r of rentRecords) {
        const m = months[r.month - 1];
        const due = Number(r.amount);
        const paid = Number(r.paidAmount ?? 0);
        const unpaid = r.status !== 'PAID';
        m.rentDue += due;
        m.rentCollected += paid;
        if (unpaid)
            m.unpaidCount += 1;
        const row = rowOf(r.contract.unitId);
        row.rentDue += due;
        row.rentCollected += paid;
        if (unpaid)
            row.unpaidCount += 1;
    }
    // 電費：總單與分攤
    const yearStart = new Date(`${year}-01-01T00:00:00+08:00`);
    const yearEnd = new Date(`${year + 1}-01-01T00:00:00+08:00`);
    const bills = await app_1.prisma.utilityBill.findMany({
        where: { category: 'ELECTRICITY', property: { userId }, periodEnd: { gte: yearStart, lt: yearEnd } },
        include: { allocations: true },
    });
    for (const b of bills) {
        months[taipeiYMD(b.periodEnd).month - 1].electricityBill += Number(b.totalAmount);
        for (const a of b.allocations)
            rowOf(a.unitId).electricityAllocated += Number(a.amount);
    }
    const expenses = await app_1.prisma.expense.findMany({
        where: {
            category: 'ELECTRICITY',
            date: { gte: yearStart, lt: yearEnd },
            OR: [{ property: { userId } }, { unit: { property: { userId } } }],
        },
    });
    for (const e of expenses)
        months[taipeiYMD(e.date).month - 1].electricityExpense += Number(e.amount);
    // 預付電表
    const prepaid = await app_1.prisma.prepaidRecord.findMany({
        where: { unit: { property: { userId } }, createdAt: { gte: yearStart, lt: yearEnd }, type: { in: ['USAGE', 'TOPUP'] } },
    });
    for (const p of prepaid) {
        const m = months[taipeiYMD(p.createdAt).month - 1];
        if (p.type === 'TOPUP') {
            m.prepaidTopup += Number(p.amount);
            continue;
        }
        m.prepaidUsage += Number(p.amount);
        m.prepaidKwh += Number(p.kwh ?? 0);
        const row = rowOf(p.unitId);
        row.prepaidUsage += Number(p.amount);
        row.prepaidKwh += Number(p.kwh ?? 0);
    }
    const sum = (k) => months.reduce((s, m) => s + m[k], 0);
    const rentDue = sum('rentDue');
    const rentCollected = sum('rentCollected');
    res.json({
        year,
        summary: {
            rentDue,
            rentCollected,
            rentOutstanding: Math.max(rentDue - rentCollected, 0),
            collectionRate: rentDue > 0 ? Math.round((rentCollected / rentDue) * 1000) / 10 : 0,
            unpaidCount: sum('unpaidCount'),
            electricityBill: sum('electricityBill'),
            electricityExpense: sum('electricityExpense'),
            prepaidUsage: sum('prepaidUsage'),
            prepaidKwh: sum('prepaidKwh'),
            prepaidTopup: sum('prepaidTopup'),
        },
        months,
        units: [...unitRows.values()].sort((a, b) => a.propertyName.localeCompare(b.propertyName) || a.unitNumber.localeCompare(b.unitNumber)),
    });
}
