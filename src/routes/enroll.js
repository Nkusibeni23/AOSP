import { Router } from 'express';
import argon2 from 'argon2';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../lib/config.js';

export const enrollRouter = Router();

const EnrollBody = z.object({
  serialNumber: z.string().min(3).max(64),
  hardwareSerial: z.string().max(64).optional(),
  imei: z.string().min(8).max(20).optional(),
  model: z.string().max(100).optional(),
  androidVersion: z.string().max(20).optional(),
  romBuild: z.string().max(100).optional(),
});

// Phone calls this during first-boot setup. The user has just logged into the
// RMSoft Enrollment app with their @rmsoft.rw account, so we expect a valid
// user JWT in the Authorization header.
enrollRouter.post('/enroll', requireAuth, async (req, res) => {
  const parsed = EnrollBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid body', detail: parsed.error.flatten() });
  }
  const { serialNumber, hardwareSerial, imei, model, androidVersion, romBuild } = parsed.data;

  const ownerId = req.auth.sub;

  const existing = await prisma.device.findUnique({ where: { serialNumber } });
  if (existing && existing.ownerId !== ownerId) {
    return res.status(409).json({ error: 'device already enrolled to a different user' });
  }

  // MQTT credentials baked into the phone — used only for the broker, not API.
  const mqttUsername = `dev_${crypto.randomBytes(8).toString('hex')}`;
  const mqttPassword = crypto.randomBytes(24).toString('base64url');
  const mqttPasswordHash = await argon2.hash(mqttPassword);

  const device = await prisma.device.upsert({
    where: { serialNumber },
    update: { hardwareSerial, imei, model, androidVersion, romBuild, lastSeenAt: new Date() },
    create: {
      serialNumber,
      hardwareSerial,
      imei,
      model,
      androidVersion,
      romBuild,
      ownerId,
      mqttUsername,
      mqttPasswordHash,
    },
  });

  return res.status(201).json({
    deviceId: device.id,
    mqtt: {
      url: config.publicMqttUrl,
      username: mqttUsername,
      password: mqttPassword,
      commandTopic: `device/${device.id}/commands`,
      ackTopic: `device/${device.id}/acks`,
      locationTopic: `device/${device.id}/location`,
    },
  });
});
