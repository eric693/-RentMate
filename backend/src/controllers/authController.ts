import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../app';
import { AuthRequest } from '../middleware/auth';

const publicUser = {
  id: true, email: true, name: true, role: true, permissions: true, ownerId: true, createdAt: true,
} as const;

/** 登入帳號統一去空白、轉小寫，避免大小寫不同被當成兩個帳號 */
export const normalizeAccount = (v: unknown) => String(v ?? '').trim().toLowerCase();

function sign(userId: string) {
  return jwt.sign({ userId }, process.env.JWT_SECRET!, { expiresIn: '30d' });
}

export async function register(req: Request, res: Response) {
  const { password, name } = req.body;
  const email = normalizeAccount(req.body.email);
  if (!email || !password || !name) {
    res.status(400).json({ error: '請填寫所有欄位' });
    return;
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: '此帳號已被使用' });
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { email, password: hash, name }, select: publicUser });
  res.json({ token: sign(user.id), user });
}

export async function login(req: Request, res: Response) {
  const { password } = req.body;
  const account = normalizeAccount(req.body.email ?? req.body.account);
  const user = await prisma.user.findFirst({ where: { email: { equals: account, mode: 'insensitive' } } });
  if (!user || !(await bcrypt.compare(String(password ?? ''), user.password))) {
    res.status(401).json({ error: '帳號或密碼錯誤' });
    return;
  }
  if (!user.active) {
    res.status(403).json({ error: '此帳號已停用，請聯絡管理員' });
    return;
  }
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const { password: _pw, ...rest } = user;
  res.json({ token: sign(user.id), user: rest });
}

export async function me(req: AuthRequest, res: Response) {
  const user = await prisma.user.findUnique({ where: { id: req.authUserId! }, select: publicUser });
  res.json(user);
}

/** 修改自己的登入帳號、名稱或密碼（需驗證目前密碼） */
export async function updateMe(req: AuthRequest, res: Response) {
  const user = await prisma.user.findUnique({ where: { id: req.authUserId! } });
  if (!user) { res.status(404).json({ error: '找不到帳號' }); return; }

  const { name, currentPassword, newPassword } = req.body;
  const account = req.body.email !== undefined ? normalizeAccount(req.body.email) : undefined;
  const changingCredentials = (account && account !== user.email) || newPassword;
  if (changingCredentials && !(await bcrypt.compare(String(currentPassword ?? ''), user.password))) {
    res.status(400).json({ error: '目前密碼不正確' });
    return;
  }
  if (account !== undefined) {
    if (account.length < 3) { res.status(400).json({ error: '帳號至少 3 個字' }); return; }
    const taken = await prisma.user.findFirst({ where: { email: { equals: account, mode: 'insensitive' }, id: { not: user.id } } });
    if (taken) { res.status(409).json({ error: '此帳號已被使用' }); return; }
  }
  if (newPassword && String(newPassword).length < 6) {
    res.status(400).json({ error: '新密碼至少 6 碼' });
    return;
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      name: name || undefined,
      email: account || undefined,
      password: newPassword ? await bcrypt.hash(String(newPassword), 10) : undefined,
    },
    select: publicUser,
  });
  res.json(updated);
}
