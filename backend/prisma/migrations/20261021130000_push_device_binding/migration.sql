ALTER TABLE "Session" ADD COLUMN "pushDeviceKeyHash" VARCHAR(64);
ALTER TABLE "PushSubscription" ADD COLUMN "deviceKeyHash" VARCHAR(64);
CREATE INDEX "PushSubscription_deviceKeyHash_idx" ON "PushSubscription"("deviceKeyHash");
