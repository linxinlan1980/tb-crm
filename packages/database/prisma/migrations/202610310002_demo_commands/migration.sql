-- AlterTable
ALTER TABLE `approval_flows` ADD COLUMN `definition` JSON NULL;

-- CreateTable
CREATE TABLE `command_executions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `actor_id` INTEGER NOT NULL,
    `request_key` VARCHAR(80) NOT NULL,
    `command` VARCHAR(100) NOT NULL,
    `payload_hash` VARCHAR(64) NOT NULL,
    `result` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `command_executions_tenant_id_actor_id_request_key_key`(`tenant_id`, `actor_id`, `request_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
