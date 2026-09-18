-- Legacy links remain valid through tokenHash and are intentionally not recoverable.
ALTER TABLE "InstallationClientLink" ADD COLUMN "tokenCiphertext" TEXT;
