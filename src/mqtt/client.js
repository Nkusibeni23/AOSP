import mqtt from 'mqtt';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

let client = null;

// How long an unacknowledged command stays in the offline queue. A stolen phone that comes back
// online after weeks must still receive its Lock/Wipe — but we bound the window so ancient commands
// don't resurrect forever.
const QUEUE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function startMqtt() {
  if (client) return client;

  client = mqtt.connect(config.mqtt.url, {
    username: config.mqtt.username,
    password: config.mqtt.password,
    clientId: `rmsoft-server-${process.pid}`,
    reconnectPeriod: 2000,
  });

  client.on('connect', () => {
    logger.info({ url: config.mqtt.url }, 'mqtt connected');
    client.subscribe('device/+/acks', { qos: 1 });
    client.subscribe('device/+/location', { qos: 0 });
    client.subscribe('device/+/heartbeat', { qos: 0 });
    client.subscribe('device/+/events', { qos: 1 });
  });

  client.on('error', (err) => {
    logger.error({ err }, 'mqtt error');
  });

  client.on('message', async (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      const match = topic.match(/^device\/([^/]+)\/(acks|location|heartbeat|events)$/);
      if (!match) return;
      const [, deviceId, kind] = match;

      if (kind === 'acks') {
        await handleAck(deviceId, payload);
      } else if (kind === 'location') {
        await handleLocation(deviceId, payload);
      } else if (kind === 'heartbeat') {
        await handleHeartbeat(deviceId, payload);
      } else if (kind === 'events') {
        await handleEvent(deviceId, payload);
      }
    } catch (err) {
      logger.error({ err, topic }, 'mqtt message handler failed');
    }
  });

  return client;
}

async function handleAck(deviceId, payload) {
  const { cmdId, ok, errorMessage } = payload;
  if (!cmdId) return;
  await prisma.command.update({
    where: { id: cmdId },
    data: {
      status: ok ? 'ACKED' : 'FAILED',
      ackedAt: new Date(),
      errorMessage: ok ? null : errorMessage ?? null,
    },
  }).catch(() => {});
  await prisma.device.update({
    where: { id: deviceId },
    data: { lastSeenAt: new Date() },
  }).catch(() => {});
}

async function handleLocation(deviceId, payload) {
  // Accept both {latitude,longitude,accuracyM} and the agent's {lat,lng,accuracy}.
  const latitude = typeof payload.latitude === 'number' ? payload.latitude : payload.lat;
  const longitude = typeof payload.longitude === 'number' ? payload.longitude : payload.lng;
  const accuracyM = payload.accuracyM ?? payload.accuracy ?? null;
  const { altitudeM = null, speedMps = null, source = null } = payload;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return;
  await prisma.locationPing.create({
    data: { deviceId, latitude, longitude, accuracyM, altitudeM, speedMps, source },
  });
  await prisma.device.update({
    where: { id: deviceId },
    data: { lastSeenAt: new Date() },
  }).catch(() => {});
}

async function handleHeartbeat(deviceId, payload) {
  const data = { lastSeenAt: new Date() };
  // Telemetry may piggyback on the heartbeat.
  if (payload && typeof payload === 'object') {
    if (typeof payload.battery === 'number') data.batteryLevel = payload.battery;
    if (typeof payload.kioskActive === 'boolean') data.kioskActive = payload.kioskActive;
    if (typeof payload.cameraDisabled === 'boolean') data.cameraDisabled = payload.cameraDisabled;
    if (typeof payload.statusBarDisabled === 'boolean') data.statusBarDisabled = payload.statusBarDisabled;
    if (typeof payload.keyguardDisabled === 'boolean') data.keyguardDisabled = payload.keyguardDisabled;
    if ('battery' in payload || 'kioskActive' in payload) data.telemetryAt = new Date();
  }
  await prisma.device.update({ where: { id: deviceId }, data }).catch(() => {});

  // The phone is online now — flush any queued commands it missed while offline.
  await redeliverPending(deviceId);
}

const ALERT_LABELS = {
  SIM_SWAP: 'SIM change detected on device',
  TAMPER: 'Tamper attempt detected (admin removal / bootloader)',
};

async function handleEvent(deviceId, payload) {
  const type = payload?.type;
  if (!type) return;
  // Any anti-theft event auto-escalates the device to LOST and records the alert for the dashboard.
  await prisma.device.update({
    where: { id: deviceId },
    data: {
      status: 'LOST',
      lastAlertType: String(type),
      lastAlertAt: new Date(),
      lastAlertInfo: String(payload.info ?? ALERT_LABELS[type] ?? type),
      lastSeenAt: new Date(),
    },
  }).catch(() => {});
  logger.warn({ deviceId, type, info: payload.info }, 'anti-theft event — device marked LOST');
}

/**
 * Re-publish every command this device hasn't acknowledged yet (created while offline, or delivered
 * but whose ack was lost). Ordered oldest-first. Called on each heartbeat, so a reconnecting phone
 * catches up automatically. Idempotent commands (LOCK/WIPE/RING) tolerate a repeat until acked.
 */
async function redeliverPending(deviceId) {
  const pending = await prisma.command.findMany({
    where: {
      deviceId,
      ackedAt: null,
      status: { in: ['PENDING', 'SENT'] },
      createdAt: { gte: new Date(Date.now() - QUEUE_TTL_MS) },
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
  }).catch(() => []);

  for (const cmd of pending) {
    await publishCommand(deviceId, {
      cmdId: cmd.id,
      type: cmd.type,
      payload: cmd.payload ?? {},
      issuedAt: cmd.createdAt.toISOString(),
    });
    if (cmd.status === 'PENDING') {
      await prisma.command.update({
        where: { id: cmd.id },
        data: { status: 'SENT', sentAt: new Date() },
      }).catch(() => {});
    }
  }
}

export function publishCommand(deviceId, payload) {
  if (!client?.connected) {
    // Not connected: leave the command PENDING; redeliverPending() flushes it on the next heartbeat.
    logger.warn({ deviceId }, 'mqtt not connected, command stays queued (PENDING)');
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    client.publish(
      `device/${deviceId}/commands`,
      JSON.stringify(payload),
      { qos: 1, retain: false },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}
