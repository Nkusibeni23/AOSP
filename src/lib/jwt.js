import jwt from 'jsonwebtoken';
import { config } from './config.js';

export function signAccess(payload) {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.accessTtlSec,
  });
}

export function signRefresh(payload) {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.refreshTtlSec,
  });
}

export function verify(token) {
  return jwt.verify(token, config.jwt.secret);
}
