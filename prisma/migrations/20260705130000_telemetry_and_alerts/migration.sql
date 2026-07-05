-- Live telemetry + anti-theft alert fields on Device.
ALTER TABLE "Device" ADD COLUMN "batteryLevel" INTEGER;
ALTER TABLE "Device" ADD COLUMN "kioskActive" BOOLEAN;
ALTER TABLE "Device" ADD COLUMN "cameraDisabled" BOOLEAN;
ALTER TABLE "Device" ADD COLUMN "statusBarDisabled" BOOLEAN;
ALTER TABLE "Device" ADD COLUMN "keyguardDisabled" BOOLEAN;
ALTER TABLE "Device" ADD COLUMN "telemetryAt" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN "lastAlertType" TEXT;
ALTER TABLE "Device" ADD COLUMN "lastAlertAt" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN "lastAlertInfo" TEXT;
