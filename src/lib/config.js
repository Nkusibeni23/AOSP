import 'dotenv/config';

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  jwt: {
    secret: required('JWT_SECRET'),
    accessTtlSec: Number(process.env.JWT_ACCESS_TTL_SEC ?? 900),
    refreshTtlSec: Number(process.env.JWT_REFRESH_TTL_SEC ?? 2592000),
  },

  allowedEmailDomain: process.env.ALLOWED_EMAIL_DOMAIN ?? 'rmsoft.rw',

  mqtt: {
    url: required('MQTT_URL'),
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
  },

  publicMqttUrl: process.env.PUBLIC_MQTT_URL ?? process.env.MQTT_URL,
};
