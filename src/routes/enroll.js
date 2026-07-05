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

  // Stable identity: the same physical phone must always map to ONE record — no duplicates across
  // wipes/re-enrolls. The hardware serial is constant per device; ANDROID_ID-based serialNumbers
  // change on wipe and used to spawn a new record every time. So dedupe by hardwareSerial first,
  // then fall back to serialNumber.
  let existing = null;
  if (hardwareSerial) {
    existing = await prisma.device.findFirst({ where: { hardwareSerial } });
  }
  if (!existing) {
    existing = await prisma.device.findUnique({ where: { serialNumber } });
  }
  if (existing && existing.ownerId !== ownerId) {
    return res.status(409).json({ error: 'device already enrolled to a different user' });
  }

  // Fresh MQTT credentials each enroll — persisted so the returned creds always match the DB hash.
  const mqttUsername = `dev_${crypto.randomBytes(8).toString('hex')}`;
  const mqttPassword = crypto.randomBytes(24).toString('base64url');
  const mqttPasswordHash = await argon2.hash(mqttPassword);

  let device;
  if (existing) {
    // Same phone re-enrolling — update in place (never create a duplicate).
    device = await prisma.device.update({
      where: { id: existing.id },
      data: {
        hardwareSerial: hardwareSerial ?? existing.hardwareSerial,
        imei,
        model,
        androidVersion,
        romBuild,
        mqttUsername,
        mqttPasswordHash,
        lastSeenAt: new Date(),
      },
    });
  } else {
    device = await prisma.device.create({
      data: {
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
  }

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
