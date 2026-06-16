import mqtt from 'mqtt';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

let client = null;

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
  });

  client.on('error', (err) => {
    logger.error({ err }, 'mqtt error');
  });

  client.on('message', async (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      const match = topic.match(/^device\/([^/]+)\/(acks|location|heartbeat)$/);
      if (!match) return;
      const [, deviceId, kind] = match;

      if (kind === 'acks') {
        await handleAck(deviceId, payload);
      } else if (kind === 'location') {
        await handleLocation(deviceId, payload);
      } else if (kind === 'heartbeat') {
        await handleHeartbeat(deviceId);
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
  const { latitude, longitude, accuracyM, altitudeM, speedMps, source } = payload;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return;
  await prisma.locationPing.create({
    data: { deviceId, latitude, longitude, accuracyM, altitudeM, speedMps, source },
  });
  await prisma.device.update({
    where: { id: deviceId },
    data: { lastSeenAt: new Date() },
  }).catch(() => {});
}

async function handleHeartbeat(deviceId) {
  await prisma.device.update({
    where: { id: deviceId },
    data: { lastSeenAt: new Date() },
  }).catch(() => {});
}

export function publishCommand(deviceId, payload) {
  if (!client?.connected) {
    logger.warn({ deviceId }, 'mqtt not connected, dropping command publish');
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
