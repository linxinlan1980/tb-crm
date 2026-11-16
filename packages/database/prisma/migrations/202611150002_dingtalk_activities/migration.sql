-- CreateTable
CREATE TABLE `calendar_entries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `owner_id` INTEGER NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NOT NULL,
    `location` VARCHAR(300) NOT NULL,
    `starts_at` DATETIME(3) NOT NULL,
    `ends_at` DATETIME(3) NOT NULL,
    `free_busy` VARCHAR(10) NOT NULL DEFAULT 'busy',
    `status` VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    `revision` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `calendar_entries_tenant_id_owner_id_starts_at_idx`(`tenant_id`, `owner_id`, `starts_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activity_sync_settings` (
    `id` VARCHAR(36) NOT NULL,
    `tenant_id` INTEGER NOT NULL,
    `owner_id` INTEGER NOT NULL,
    `binding_hash` VARCHAR(64) NOT NULL,
    `calendar_enabled` BOOLEAN NOT NULL DEFAULT false,
    `todo_enabled` BOOLEAN NOT NULL DEFAULT false,
    `auto_enabled` BOOLEAN NOT NULL DEFAULT false,
    `last_scanned_at` DATETIME(3) NULL,
    `last_error` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `activity_sync_settings_tenant_id_owner_id_key`(`tenant_id`, `owner_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activity_sync_links` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `owner_id` INTEGER NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `source_id` INTEGER NOT NULL,
    `binding_hash` VARCHAR(64) NOT NULL,
    `external_id` VARCHAR(200) NOT NULL,
    `source_version` VARCHAR(64) NOT NULL,
    `archived_at` DATETIME(3) NULL,
    `payload` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `activity_sync_links_tenant_id_owner_id_kind_source_id_key`(`tenant_id`, `owner_id`, `kind`, `source_id`),
    UNIQUE INDEX `activity_sync_links_tenant_id_binding_hash_kind_external_id_key`(`tenant_id`, `binding_hash`, `kind`, `external_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activity_sync_jobs` (
    `id` VARCHAR(36) NOT NULL,
    `tenant_id` INTEGER NOT NULL,
    `owner_id` INTEGER NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `source_id` INTEGER NOT NULL,
    `source_version` VARCHAR(64) NOT NULL,
    `binding_hash` VARCHAR(64) NOT NULL,
    `settings_version` DATETIME(3) NOT NULL,
    `operation` VARCHAR(20) NOT NULL,
    `payload` JSON NOT NULL,
    `external_id` VARCHAR(200) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'prepared',
    `lease_token` VARCHAR(36) NULL,
    `force_overwrite` BOOLEAN NOT NULL DEFAULT false,
    `error` VARCHAR(500) NULL,
    `evidence` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `activity_sync_jobs_tenant_id_owner_id_status_idx`(`tenant_id`, `owner_id`, `status`),
    UNIQUE INDEX `activity_sync_jobs_tenant_id_owner_id_kind_source_id_source__key`(`tenant_id`, `owner_id`, `kind`, `source_id`, `source_version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

