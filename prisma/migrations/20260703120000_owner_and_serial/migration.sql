-- Add the real hardware serial + owner label to devices,
-- and the SET_OWNER command type.
ALTER TABLE "Device" ADD COLUMN "hardwareSerial" TEXT;
ALTER TABLE "Device" ADD COLUMN "ownerLabel" TEXT;
ALTER TYPE "CommandType" ADD VALUE 'SET_OWNER';
