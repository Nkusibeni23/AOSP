import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { publishCommand } from '../mqtt/client.js';

export const devicesRouter = Router();

devicesRouter.use(requireAuth);

devicesRouter.get('/', async (req, res) => {
  const where = req.auth.role === 'ADMIN' || req.auth.role === 'SUPER'
    ? {}
    : { ownerId: req.auth.sub };

  const devices = await prisma.device.findMany({
    where,
    orderBy: { enrolledAt: 'desc' },
    include: {
      owner: { select: { email: true, fullName: true } },
      locations: { orderBy: { reportedAt: 'desc' }, take: 1 },
    },
  });
  res.json(devices);
});

devicesRouter.get('/:id', async (req, res) => {
  const device = await prisma.device.findUnique({
    where: { id: req.params.id },
    include: {
      owner: { select: { email: true, fullName: true } },
      locations: { orderBy: { reportedAt: 'desc' }, take: 50 },
      commands: { orderBy: { createdAt: 'desc' }, take: 50 },
    },
  });
  if (!device) return res.status(404).json({ error: 'not found' });
  if (device.ownerId !== req.auth.sub && !['ADMIN', 'SUPER'].includes(req.auth.role)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.json(device);
});

const CommandBody = z.object({
  type: z.enum(['LOCK', 'WIPE', 'LOCATE_NOW', 'RING', 'MESSAGE', 'UNLOCK', 'SET_OWNER']),
  payload: z.record(z.any()).optional(),
});

devicesRouter.post('/:id/commands', async (req, res) => {
  const parsed = CommandBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid body', detail: parsed.error.flatten() });
  }
  const { type, payload } = parsed.data;

  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) return res.status(404).json({ error: 'not found' });
  if (device.ownerId !== req.auth.sub && !['ADMIN', 'SUPER'].includes(req.auth.role)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const command = await prisma.command.create({
    data: {
      deviceId: device.id,
      issuedById: req.auth.sub,
      type,
      payload: payload ?? {},
    },
  });

  // Mark phone as LOST on first WIPE/LOCK from owner.
  if (type === 'WIPE' || type === 'LOCK') {
    await prisma.device.update({
      where: { id: device.id },
      data: { status: 'LOST' },
    });
  }

  // Remember the owner name we pushed to the lock screen.
  if (type === 'SET_OWNER' && payload?.name) {
    await prisma.device.update({
      where: { id: device.id },
      data: { ownerLabel: String(payload.name) },
    });
  }

  await publishCommand(device.id, {
    cmdId: command.id,
    type,
    payload: payload ?? {},
    issuedAt: command.createdAt.toISOString(),
  });

  await prisma.command.update({
    where: { id: command.id },
    data: { status: 'SENT', sentAt: new Date() },
  });

  res.status(202).json(command);
});

// Remove a device (and its commands + location history). Used to clean up
// duplicate records left behind by wipe/re-enroll cycles.
devicesRouter.delete('/:id', async (req, res) => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) return res.status(404).json({ error: 'not found' });
  if (device.ownerId !== req.auth.sub && !['ADMIN', 'SUPER'].includes(req.auth.role)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  await prisma.command.deleteMany({ where: { deviceId: device.id } });
  await prisma.locationPing.deleteMany({ where: { deviceId: device.id } });
  await prisma.device.delete({ where: { id: device.id } });
  res.status(204).end();
});

devicesRouter.post('/:id/mark-found', async (req, res) => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) return res.status(404).json({ error: 'not found' });
  if (device.ownerId !== req.auth.sub && !['ADMIN', 'SUPER'].includes(req.auth.role)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const updated = await prisma.device.update({
    where: { id: device.id },
    data: { status: 'ACTIVE' },
  });
  res.json(updated);
});
