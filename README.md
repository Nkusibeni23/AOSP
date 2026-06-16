# RMSoft Server

Backend for RMSoft OS dashboard — device enrollment, MDM commands (lock, wipe, locate, ring), and location tracking. Companion to the custom AOSP build at `/Volumes/nkusi/aosp-pixel8`.

## Stack

- **Node.js 20 + Express** — REST API
- **PostgreSQL 16** — durable storage (devices, users, commands, locations)
- **Mosquitto 2** — MQTT broker for real-time phone↔server commands
- **Redis 7** — reserved for command queue / rate limits (not required yet)
- **Prisma** — type-safe ORM + migrations

For the prototype these all run via Docker Compose. Swap to managed services for production.

## Quick start

```bash
# 0. prerequisites: Node 20+, Docker Desktop running
node --version
docker --version

# 1. install deps
npm install

# 2. copy env file and fill in secrets
cp .env.example .env
# generate JWT_SECRET:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# paste it into .env as JWT_SECRET

# 3. start infra (postgres + mosquitto + redis)
npm run db:up

# 4. apply schema + create admin user
npm run db:migrate
npm run db:seed   # creates admin@rmsoft.rw / changeme123

# 5. run the API
npm run dev
# → listening on :3000
```

In another terminal, smoke test:

```bash
bash scripts/test-flow.sh
```

This registers a user, enrolls a fake device, and issues a `LOCATE_NOW` command. Watch it land on MQTT in a third terminal:

```bash
docker exec -it rmsoft-mosquitto mosquitto_sub -t 'device/+/commands' -v
```

## API surface

### Auth
| Method | Path                  | Auth | Body                            |
| ------ | --------------------- | ---- | ------------------------------- |
| POST   | `/api/auth/register`  | none | `{email, password, fullName?}`  |
| POST   | `/api/auth/login`     | none | `{email, password}` → tokens    |

Email must end with `@rmsoft.rw` (configurable via `ALLOWED_EMAIL_DOMAIN`).

### Enrollment (called by the on-phone RmsoftEnrollment app)
| Method | Path           | Auth   | Body                                                   |
| ------ | -------------- | ------ | ------------------------------------------------------ |
| POST   | `/api/enroll`  | Bearer | `{serialNumber, imei?, model?, androidVersion?, ...}`  |

Returns per-device MQTT credentials and topics.

### Devices (called by dashboard UI)
| Method | Path                                | Auth   | Notes                                            |
| ------ | ----------------------------------- | ------ | ------------------------------------------------ |
| GET    | `/api/devices`                      | Bearer | List user's devices (admins see all)             |
| GET    | `/api/devices/:id`                  | Bearer | Detail + recent locations + recent commands      |
| POST   | `/api/devices/:id/commands`         | Bearer | `{type: LOCK\|WIPE\|LOCATE_NOW\|RING\|MESSAGE\|UNLOCK, payload?}` |
| POST   | `/api/devices/:id/mark-found`       | Bearer | Reset status from LOST → ACTIVE                  |

### MQTT topic conventions

Topics, all per-device:
- `device/{deviceId}/commands` — server → phone (commands)
- `device/{deviceId}/acks` — phone → server (command acks)
- `device/{deviceId}/location` — phone → server (GPS pings)
- `device/{deviceId}/heartbeat` — phone → server (alive ping)

## Where to deploy

For 10–100 phones, this whole stack runs on **one Hetzner CCX13** (~€15/month, 2 vCPU, 8 GB RAM). Add Caddy in front for automatic Let's Encrypt:

```caddy
dashboard.rmsoft.rw {
    reverse_proxy localhost:3000
}
```

For MQTT-over-TLS you need to swap `mosquitto.conf` to a TLS listener on `8883` and provision a cert (Caddy can do this too via the `tls` directive, or use `certbot`).

## Things still TODO before this is production-ready

- [ ] TLS for MQTT (`mosquitto.conf` currently anonymous + plaintext — DEV ONLY)
- [ ] Per-device MQTT ACLs (right now any device with broker creds can read other topics)
- [ ] Command signing — sign commands with admin keypair so MQTT compromise doesn't allow rogue wipes
- [ ] Refresh token rotation + revocation
- [ ] Rate limit per-account, not just per-IP
- [ ] Tests
- [ ] Audit log table separate from `Command.status`
- [ ] FIDO2 / hardware key login for admins
- [ ] Cert-pinned mTLS for the phone↔API channel
