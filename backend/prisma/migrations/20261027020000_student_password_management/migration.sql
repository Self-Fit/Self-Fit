ALTER TABLE "User" ADD COLUMN "temporaryPasswordCiphertext" TEXT, ADD COLUMN "temporaryPasswordIssuedAt" TIMESTAMP(3), ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD CONSTRAINT "User_temporary_password_pending_check" CHECK ("temporaryPasswordCiphertext" IS NULL OR (role = 'student' AND "mustChangePassword" = true));
