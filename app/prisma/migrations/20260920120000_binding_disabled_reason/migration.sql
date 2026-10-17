-- CreateEnum
CREATE TYPE "BindingDisabledReason" AS ENUM ('USER', 'INSTALLATION_SUSPENDED');

-- AlterTable
ALTER TABLE "repository_bindings" ADD COLUMN "disabledReason" "BindingDisabledReason";
