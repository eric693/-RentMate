// 各模組補齊的新增／編輯／刪除端點（原本只有部分操作的資源集中在這裡）。
import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { prisma } from '../app';

const num = (v: unknown) => (v === '' || v == null ? undefined : Number(v));
const date = (v: unknown) => (v ? new Date(String(v)) : undefined);

// ── 租金記錄 ──────────────────────────────────────────────────────

async function ownRentRecord(id: string, userId: string) {
  return prisma.rentRecord.findFirst({
    where: { id, contract: { unit: { property: { userId } } } },
  });
}

/** 手動新增一筆租金單（例如補開漏掉的月份） */
export async function createRentRecord(req: AuthRequest, res: Response) {
  const { contractId, year, month, amount, dueDate, notes } = req.body;
  const contract = await prisma.contract.findFirst({
    where: { id: contractId, unit: { property: { userId: req.userId! } } },
  });
  if (!contract) { res.status(404).json({ error: '找不到合約' }); return; }
  const y = Number(year);
  const m = Number(month);
  if (!y || !m || m < 1 || m > 12) { res.status(400).json({ error: '請填寫正確的年月' }); return; }

  const exists = await prisma.rentRecord.findUnique({ where: { contractId_year_month: { contractId, year: y, month: m } } });
  if (exists) { res.status(409).json({ error: `${y}/${m} 已有租金單，請直接編輯` }); return; }

  const lastDay = new Date(y, m, 0).getDate();
  const due = date(dueDate) ?? new Date(`${y}-${String(m).padStart(2, '0')}-${String(Math.min(contract.rentDueDay, lastDay)).padStart(2, '0')}T00:00:00+08:00`);
  const record = await prisma.rentRecord.create({
    data: {
      contractId, year: y, month: m, dueDate: due,
      amount: num(amount) ?? Number(contract.monthlyRent),
      status: due < new Date() ? 'OVERDUE' : 'PENDING',
      notes: notes || null,
    },
  });
  res.status(201).json(record);
}

/** 編輯租金單：金額、到期日、收款資訊、狀態、備註 */
export async function updateRentRecord(req: AuthRequest, res: Response) {
  const record = await ownRentRecord(req.params.id, req.userId!);
  if (!record) { res.status(404).json({ error: '找不到租金記錄' }); return; }

  const { amount, dueDate, paidDate, paidAmount, status, paymentMethod, notes } = req.body;
  const data: Prisma.RentRecordUpdateInput = {
    amount: num(amount),
    dueDate: date(dueDate),
    paymentMethod: paymentMethod ?? undefined,
    notes: notes ?? undefined,
  };
  if (status === 'PENDING' || status === 'OVERDUE') {
    // 改回未繳：清掉收款資訊
    Object.assign(data, { status, paidDate: null, paidAmount: null });
  } else {
    if (paidAmount !== undefined) data.paidAmount = num(paidAmount) ?? null;
    if (paidDate !== undefined) data.paidDate = date(paidDate) ?? null;
    if (status) data.status = status;
    // 標成已繳／部分繳但沒給收款日：用今天
    if ((status === 'PAID' || status === 'PARTIAL') && !data.paidDate && !record.paidDate) data.paidDate = new Date();
  }
  res.json(await prisma.rentRecord.update({ where: { id: record.id }, data }));
}

export async function deleteRentRecord(req: AuthRequest, res: Response) {
  const record = await ownRentRecord(req.params.id, req.userId!);
  if (!record) { res.status(404).json({ error: '找不到租金記錄' }); return; }
  await prisma.$transaction([
    prisma.reminderLog.deleteMany({ where: { rentRecordId: record.id } }),
    // 已對上的金流改回未對帳，錢還在，不跟著刪
    prisma.payment.updateMany({ where: { rentRecordId: record.id }, data: { rentRecordId: null, status: 'UNMATCHED', reconciledAt: null } }),
    prisma.rentRecord.delete({ where: { id: record.id } }),
  ]);
  res.json({ ok: true });
}

// ── 合約 ──────────────────────────────────────────────────────────

/** 刪除合約（連同其租金單、點交、押金退還紀錄）。建錯合約時使用；正常結束請用「終止」。 */
export async function deleteContract(req: AuthRequest, res: Response) {
  const contract = await prisma.contract.findFirst({
    where: { id: req.params.id, unit: { property: { userId: req.userId! } } },
  });
  if (!contract) { res.status(404).json({ error: '找不到合約' }); return; }

  const recordIds = (await prisma.rentRecord.findMany({ where: { contractId: contract.id }, select: { id: true } })).map((r) => r.id);
  await prisma.$transaction([
    prisma.reminderLog.deleteMany({ where: { rentRecordId: { in: recordIds } } }),
    prisma.payment.updateMany({
      where: { contractId: contract.id },
      data: { contractId: null, rentRecordId: null, virtualAccountId: null, status: 'UNMATCHED', reconciledAt: null },
    }),
    prisma.rentRecord.deleteMany({ where: { contractId: contract.id } }),
    prisma.depositDeduction.deleteMany({ where: { depositRefund: { contractId: contract.id } } }),
    prisma.depositRefund.deleteMany({ where: { contractId: contract.id } }),
    prisma.contract.delete({ where: { id: contract.id } }), // 點交、虛擬帳號為 onDelete: Cascade
  ]);

  const stillActive = await prisma.contract.count({ where: { unitId: contract.unitId, status: 'ACTIVE' } });
  if (stillActive === 0) await prisma.unit.update({ where: { id: contract.unitId }, data: { status: 'VACANT' } });
  res.json({ ok: true });
}

// ── 報修 ──────────────────────────────────────────────────────────

export async function deleteMaintenanceRequest(req: AuthRequest, res: Response) {
  const item = await prisma.maintenanceRequest.findFirst({
    where: { id: req.params.id, unit: { property: { userId: req.userId! } } },
  });
  if (!item) { res.status(404).json({ error: '找不到報修單' }); return; }
  await prisma.maintenanceRequest.delete({ where: { id: item.id } });
  res.json({ ok: true });
}

// ── 支出 ──────────────────────────────────────────────────────────

export async function updateExpense(req: AuthRequest, res: Response) {
  const expense = await prisma.expense.findFirst({
    where: {
      id: req.params.id,
      OR: [{ property: { userId: req.userId! } }, { unit: { property: { userId: req.userId! } } }],
    },
  });
  if (!expense) { res.status(404).json({ error: '找不到支出' }); return; }

  const { propertyId, unitId, category, amount, date: d, description } = req.body;
  if (propertyId) {
    const prop = await prisma.property.findFirst({ where: { id: propertyId, userId: req.userId! } });
    if (!prop) { res.status(404).json({ error: '找不到物業' }); return; }
  }
  const updated = await prisma.expense.update({
    where: { id: expense.id },
    data: {
      propertyId: propertyId === undefined ? undefined : propertyId || null,
      unitId: unitId === undefined ? undefined : unitId || null,
      category: category || undefined,
      amount: num(amount),
      date: date(d),
      description: description ?? undefined,
    },
  });
  res.json(updated);
}

// ── 水電帳單（總單＋分攤）─────────────────────────────────────────

async function ownUtilityBill(id: string, userId: string) {
  return prisma.utilityBill.findFirst({ where: { id, property: { userId } }, include: { allocations: true } });
}

/**
 * 編輯水電總單：期間、備註，以及各房分攤金額（總額 = 各房加總）。
 * allocations: [{ id, amount }]
 */
export async function updateUtilityBill(req: AuthRequest, res: Response) {
  const bill = await ownUtilityBill(req.params.id, req.userId!);
  if (!bill) { res.status(404).json({ error: '找不到帳單' }); return; }

  const { periodStart, periodEnd, note, allocations } = req.body as {
    periodStart?: string; periodEnd?: string; note?: string;
    allocations?: { id: string; amount: number }[];
  };
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  let total = Number(bill.totalAmount);
  if (Array.isArray(allocations)) {
    const byId = new Map(bill.allocations.map((a) => [a.id, a]));
    total = 0;
    for (const a of bill.allocations) {
      const edit = allocations.find((x) => x.id === a.id);
      const amt = edit ? Number(edit.amount) : Number(a.amount);
      total += amt;
      if (edit && byId.has(edit.id)) ops.push(prisma.utilityAllocation.update({ where: { id: a.id }, data: { amount: amt } }));
    }
  }
  ops.push(prisma.utilityBill.update({
    where: { id: bill.id },
    data: {
      periodStart: date(periodStart),
      periodEnd: date(periodEnd),
      note: note ?? undefined,
      totalAmount: Math.round(total * 100) / 100,
    },
  }));
  await prisma.$transaction(ops);
  res.json(await ownUtilityBill(bill.id, req.userId!));
}

export async function deleteUtilityBill(req: AuthRequest, res: Response) {
  const bill = await ownUtilityBill(req.params.id, req.userId!);
  if (!bill) { res.status(404).json({ error: '找不到帳單' }); return; }
  await prisma.utilityBill.delete({ where: { id: bill.id } }); // 分攤明細 onDelete: Cascade
  res.json({ ok: true });
}

// ── 預付電表流水 ──────────────────────────────────────────────────
// 改或刪一筆流水時，這筆之後每一筆的 balanceAfter 與房間目前餘額都要一起平移。

async function ownPrepaidRecord(id: string, userId: string) {
  return prisma.prepaidRecord.findFirst({ where: { id, unit: { property: { userId } } } });
}

/** 這筆流水對餘額造成的增減（ADJUST 只存絕對值，用前一筆餘額反推正負） */
async function deltaOf(rec: { id: string; unitId: string; type: string; amount: Prisma.Decimal; balanceAfter: Prisma.Decimal; createdAt: Date }) {
  if (rec.type === 'TOPUP') return Number(rec.amount);
  if (rec.type === 'USAGE') return -Number(rec.amount);
  const prev = await prisma.prepaidRecord.findFirst({
    where: { unitId: rec.unitId, OR: [{ createdAt: { lt: rec.createdAt } }, { createdAt: rec.createdAt, id: { lt: rec.id } }] },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return Number(rec.balanceAfter) - Number(prev?.balanceAfter ?? 0);
}

function shiftLater(rec: { id: string; unitId: string; createdAt: Date }, diff: number) {
  return [
    prisma.prepaidRecord.updateMany({
      where: { unitId: rec.unitId, OR: [{ createdAt: { gt: rec.createdAt } }, { createdAt: rec.createdAt, id: { gt: rec.id } }] },
      data: { balanceAfter: { increment: diff } },
    }),
    prisma.unit.update({ where: { id: rec.unitId }, data: { prepaidBalance: { increment: diff } } }),
  ];
}

/** 編輯流水：金額（TOPUP/USAGE/ADJUST）、度數、備註 */
export async function updatePrepaidRecord(req: AuthRequest, res: Response) {
  const rec = await ownPrepaidRecord(req.params.id, req.userId!);
  if (!rec) { res.status(404).json({ error: '找不到紀錄' }); return; }

  const { amount, kwh, note } = req.body;
  const oldDelta = await deltaOf(rec);
  const newAmount = num(amount) ?? Number(rec.amount);
  if (newAmount < 0) { res.status(400).json({ error: '金額不可為負數' }); return; }
  const sign = rec.type === 'USAGE' ? -1 : rec.type === 'TOPUP' ? 1 : Math.sign(oldDelta) || 1;
  const diff = sign * newAmount - oldDelta;

  await prisma.$transaction([
    prisma.prepaidRecord.update({
      where: { id: rec.id },
      data: {
        amount: newAmount,
        kwh: kwh === undefined ? undefined : num(kwh) ?? null,
        note: note ?? undefined,
        balanceAfter: { increment: diff },
      },
    }),
    ...(diff !== 0 ? shiftLater(rec, diff) : []),
  ]);
  res.json({ ok: true });
}

export async function deletePrepaidRecord(req: AuthRequest, res: Response) {
  const rec = await ownPrepaidRecord(req.params.id, req.userId!);
  if (!rec) { res.status(404).json({ error: '找不到紀錄' }); return; }
  const delta = await deltaOf(rec);
  await prisma.$transaction([
    prisma.prepaidRecord.delete({ where: { id: rec.id } }),
    ...shiftLater(rec, -delta),
  ]);
  res.json({ ok: true });
}

// ── 租約範本 ──────────────────────────────────────────────────────

export async function updateContractTemplate(req: AuthRequest, res: Response) {
  const tpl = await prisma.contractTemplate.findFirst({ where: { id: req.params.templateId, userId: req.userId! } });
  if (!tpl) { res.status(404).json({ error: '找不到範本' }); return; }
  const { name, body } = req.body;
  res.json(await prisma.contractTemplate.update({
    where: { id: tpl.id },
    data: { name: name || undefined, body: body ?? undefined },
  }));
}

// ── 入帳（對帳中心）───────────────────────────────────────────────

/**
 * 刪除一筆尚未銷帳的入帳（重複匯入、測試資料）。已銷帳的不能刪，避免帳對不起來。
 * 只能刪自己合約的入帳；沒有對應合約的入帳無法確認歸屬，不開放刪除。
 */
export async function deletePayment(req: AuthRequest, res: Response) {
  const userId = req.userId!;
  const payment = await prisma.payment.findFirst({
    where: {
      id: req.params.id,
      OR: [
        { contract: { unit: { property: { userId } } } },
        { virtualAccount: { contract: { unit: { property: { userId } } } } },
      ],
    },
  });
  if (!payment) { res.status(404).json({ error: '找不到入帳' }); return; }
  if (payment.status === 'MATCHED' || payment.status === 'MANUAL') {
    res.status(400).json({ error: '已銷帳的入帳不可刪除' }); return;
  }
  await prisma.payment.delete({ where: { id: payment.id } });
  res.json({ ok: true });
}
