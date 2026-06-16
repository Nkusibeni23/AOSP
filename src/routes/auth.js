import { Router } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { signAccess, signRefresh } from '../lib/jwt.js';
import { config } from '../lib/config.js';

export const authRouter = Router();

const RegisterBody = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  fullName: z.string().min(1).max(200).optional(),
});

authRouter.post('/register', async (req, res) => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid body', detail: parsed.error.flatten() });
  }
  const { email, password, fullName } = parsed.data;

  const expectedDomain = '@' + config.allowedEmailDomain;
  if (!email.toLowerCase().endsWith(expectedDomain)) {
    return res.status(403).json({ error: `email must end with ${expectedDomain}` });
  }

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) return res.status(409).json({ error: 'email already registered' });

  const passwordHash = await argon2.hash(password);
  const user = await prisma.user.create({
    data: { email: email.toLowerCase(), passwordHash, fullName },
  });
  return res.status(201).json({ id: user.id, email: user.email });
});

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string(),
});

authRouter.post('/login', async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid body' });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return res.status(401).json({ error: 'invalid credentials' });

  const ok = await argon2.verify(user.passwordHash, password);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });

  const claims = { sub: user.id, email: user.email, role: user.role };
  return res.json({
    accessToken: signAccess(claims),
    refreshToken: signRefresh({ sub: user.id }),
    user: { id: user.id, email: user.email, role: user.role, fullName: user.fullName },
  });
});
