-- CreateTable
CREATE TABLE `integration_connections` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `provider` VARCHAR(30) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `integration_connections_tenant_id_provider_key`(`tenant_id`, `provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `integration_runs` (
    `id` VARCHAR(36) NOT NULL,
    `tenant_id` INTEGER NOT NULL,
    `provider` VARCHAR(30) NOT NULL,
    `kind` VARCHAR(30) NOT NULL,
    `status` VARCHAR(30) NOT NULL,
    `actor_id` INTEGER NOT NULL,
    `binding_hash` VARCHAR(64) NOT NULL,
    `snapshot` JSON NULL,
    `summary` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `integration_runs_tenant_id_provider_created_at_idx`(`tenant_id`, `provider`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `integration_mappings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `provider` VARCHAR(30) NOT NULL,
    `binding_hash` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(30) NOT NULL,
    `external_id` VARCHAR(100) NOT NULL,
    `local_id` INTEGER NOT NULL,
    `external_name` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `integration_mappings_tenant_id_provider_kind_external_id_key`(`tenant_id`, `provider`, `kind`, `external_id`),
    UNIQUE INDEX `integration_mappings_tenant_id_provider_kind_local_id_key`(`tenant_id`, `provider`, `kind`, `local_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

