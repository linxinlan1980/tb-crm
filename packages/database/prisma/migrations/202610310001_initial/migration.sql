-- CreateTable
CREATE TABLE `tenants` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `plan` ENUM('basic', 'professional', 'enterprise') NOT NULL DEFAULT 'basic',
    `max_users` INTEGER NOT NULL DEFAULT 10,
    `max_customers` INTEGER NOT NULL DEFAULT 1000,
    `config` JSON NULL,
    `brand_logo` VARCHAR(500) NULL,
    `brand_color` VARCHAR(10) NULL,
    `status` ENUM('trial', 'active', 'suspended', 'cancelled') NOT NULL DEFAULT 'trial',
    `trial_ends_at` DATE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenants_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `departments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `parent_id` INTEGER NULL,
    `name` VARCHAR(100) NOT NULL,
    `code` VARCHAR(30) NULL,
    `leader_id` INTEGER NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `status` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `departments_tenant_id_idx`(`tenant_id`),
    INDEX `departments_parent_id_idx`(`parent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `username` VARCHAR(50) NOT NULL,
    `password_hash` VARCHAR(200) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `phone` VARCHAR(200) NULL,
    `email` VARCHAR(100) NULL,
    `avatar_url` VARCHAR(500) NULL,
    `dept_id` INTEGER NULL,
    `position` VARCHAR(50) NULL,
    `dingtalk_userid` VARCHAR(50) NULL,
    `wecom_userid` VARCHAR(50) NULL,
    `status` ENUM('active', 'inactive', 'resigned') NOT NULL DEFAULT 'active',
    `last_login_at` DATETIME(3) NULL,
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `users_tenant_id_dept_id_idx`(`tenant_id`, `dept_id`),
    INDEX `users_dingtalk_userid_idx`(`dingtalk_userid`),
    UNIQUE INDEX `users_tenant_id_username_key`(`tenant_id`, `username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `description` VARCHAR(200) NULL,
    `data_scope` ENUM('self', 'team', 'dept', 'custom', 'all') NOT NULL DEFAULT 'self',
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `permissions` JSON NULL,
    `field_permissions` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `roles_tenant_id_idx`(`tenant_id`),
    UNIQUE INDEX `roles_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_roles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `role_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_roles_user_id_idx`(`user_id`),
    UNIQUE INDEX `user_roles_tenant_id_user_id_role_id_key`(`tenant_id`, `user_id`, `role_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `short_name` VARCHAR(100) NULL,
    `group_id` INTEGER NULL,
    `industry` VARCHAR(50) NULL,
    `level` VARCHAR(20) NULL,
    `source` VARCHAR(50) NULL,
    `pool_type` ENUM('public', 'dept', 'private') NOT NULL DEFAULT 'public',
    `owner_id` INTEGER NULL,
    `owner_dept_id` INTEGER NULL,
    `protect_until` DATE NULL,
    `status` ENUM('active', 'inactive', 'churned') NOT NULL DEFAULT 'active',
    `is_prospect` BOOLEAN NOT NULL DEFAULT true,
    `is_trading` BOOLEAN NOT NULL DEFAULT false,
    `yonyou_code` VARCHAR(30) NULL,
    `tax_type` VARCHAR(20) NULL,
    `currency` VARCHAR(10) NOT NULL DEFAULT 'CNY',
    `address` VARCHAR(500) NULL,
    `region` VARCHAR(50) NULL,
    `website` VARCHAR(200) NULL,
    `registered_capital` DECIMAL(15, 2) NULL,
    `established_date` DATE NULL,
    `legal_person` VARCHAR(50) NULL,
    `credit_code` VARCHAR(18) NULL,
    `employee_count` VARCHAR(20) NULL,
    `yonyou_product` VARCHAR(100) NULL,
    `yonyou_modules` TEXT NULL,
    `service_expiry` DATE NULL,
    `contract_count` INTEGER NOT NULL DEFAULT 0,
    `contract_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `last_follow_at` DATETIME(3) NULL,
    `last_follow_by` INTEGER NULL,
    `ai_profile` TEXT NULL,
    `ai_profile_at` DATETIME(3) NULL,
    `tags` JSON NULL,
    `remark` TEXT NULL,
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `customers_tenant_id_owner_id_idx`(`tenant_id`, `owner_id`),
    INDEX `customers_tenant_id_pool_type_idx`(`tenant_id`, `pool_type`),
    INDEX `customers_tenant_id_industry_idx`(`tenant_id`, `industry`),
    INDEX `customers_credit_code_idx`(`credit_code`),
    INDEX `customers_name_idx`(`name`),
    INDEX `customers_group_id_idx`(`group_id`),
    INDEX `customers_protect_until_idx`(`protect_until`),
    INDEX `customers_last_follow_at_idx`(`last_follow_at`),
    UNIQUE INDEX `customers_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contacts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `title` VARCHAR(50) NULL,
    `department` VARCHAR(50) NULL,
    `phone` VARCHAR(200) NULL,
    `email` VARCHAR(100) NULL,
    `wechat` VARCHAR(50) NULL,
    `decision_role` ENUM('decision_maker', 'influencer', 'user', 'coach', 'gatekeeper') NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `birthday` DATE NULL,
    `preference` TEXT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `contacts_tenant_id_customer_id_idx`(`tenant_id`, `customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contact_relations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `from_contact_id` INTEGER NOT NULL,
    `to_contact_id` INTEGER NOT NULL,
    `relation_type` ENUM('reports_to', 'influences', 'collaborates', 'blocks') NOT NULL,
    `strength` ENUM('strong', 'medium', 'weak') NOT NULL DEFAULT 'medium',
    `remark` VARCHAR(200) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `contact_relations_tenant_id_customer_id_idx`(`tenant_id`, `customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_addresses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `type` ENUM('registered', 'office', 'delivery', 'invoice') NOT NULL DEFAULT 'office',
    `province` VARCHAR(20) NULL,
    `city` VARCHAR(20) NULL,
    `district` VARCHAR(20) NULL,
    `detail` VARCHAR(200) NOT NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `customer_addresses_tenant_id_customer_id_idx`(`tenant_id`, `customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_banks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `bank_name` VARCHAR(100) NOT NULL,
    `account_name` VARCHAR(200) NOT NULL,
    `account_no` VARCHAR(200) NOT NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `customer_banks_tenant_id_customer_id_idx`(`tenant_id`, `customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_invoices_info` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `invoice_title` VARCHAR(200) NOT NULL,
    `tax_no` VARCHAR(20) NOT NULL,
    `bank_name` VARCHAR(100) NULL,
    `bank_account` VARCHAR(200) NULL,
    `address` VARCHAR(200) NULL,
    `phone` VARCHAR(20) NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `customer_invoices_info_tenant_id_customer_id_idx`(`tenant_id`, `customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leads` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `company_name` VARCHAR(200) NOT NULL,
    `contact_name` VARCHAR(50) NULL,
    `contact_phone` VARCHAR(200) NULL,
    `contact_email` VARCHAR(100) NULL,
    `contact_title` VARCHAR(50) NULL,
    `source` VARCHAR(50) NOT NULL,
    `source_detail` VARCHAR(200) NULL,
    `campaign_id` INTEGER NULL,
    `partner_id` INTEGER NULL,
    `industry` VARCHAR(50) NULL,
    `region` VARCHAR(50) NULL,
    `employee_count` VARCHAR(20) NULL,
    `demand` TEXT NULL,
    `demand_products` JSON NULL,
    `budget_range` VARCHAR(30) NULL,
    `expected_time` VARCHAR(30) NULL,
    `score` INTEGER NOT NULL DEFAULT 0,
    `score_detail` JSON NULL,
    `status` ENUM('new', 'cleaning', 'qualified', 'unqualified', 'assigned', 'converted', 'rejected', 'expired') NOT NULL DEFAULT 'new',
    `quality_flag` ENUM('valid', 'invalid_phone', 'duplicate', 'not_target', 'competitor') NOT NULL DEFAULT 'valid',
    `assignee_id` INTEGER NULL,
    `assigned_at` DATETIME(3) NULL,
    `converted_customer_id` INTEGER NULL,
    `converted_opportunity_id` INTEGER NULL,
    `converted_at` DATETIME(3) NULL,
    `reject_reason` VARCHAR(200) NULL,
    `expire_at` DATETIME(3) NULL,
    `follow_count` INTEGER NOT NULL DEFAULT 0,
    `last_follow_at` DATETIME(3) NULL,
    `credit_code` VARCHAR(18) NULL,
    `ai_enrichment` JSON NULL,
    `remark` TEXT NULL,
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `leads_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `leads_tenant_id_assignee_id_idx`(`tenant_id`, `assignee_id`),
    INDEX `leads_company_name_idx`(`company_name`),
    INDEX `leads_credit_code_idx`(`credit_code`),
    INDEX `leads_score_idx`(`score`),
    UNIQUE INDEX `leads_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_follow_ups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `lead_id` INTEGER NOT NULL,
    `method` ENUM('visit', 'phone', 'wechat', 'email', 'meeting', 'other') NOT NULL,
    `content` TEXT NOT NULL,
    `result` ENUM('connected', 'no_answer', 'rejected', 'interested', 'need_follow') NULL,
    `next_action` VARCHAR(200) NULL,
    `next_follow_at` DATETIME(3) NULL,
    `created_by` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lead_follow_ups_tenant_id_lead_id_idx`(`tenant_id`, `lead_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pool_configs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `pool_type` ENUM('public', 'dept') NOT NULL,
    `dept_id` INTEGER NULL,
    `name` VARCHAR(50) NOT NULL,
    `max_claim_per_day` INTEGER NOT NULL DEFAULT 3,
    `protect_days` INTEGER NOT NULL DEFAULT 30,
    `follow_required_days` INTEGER NOT NULL DEFAULT 15,
    `auto_recycle_days` INTEGER NOT NULL DEFAULT 60,
    `recycle_to` ENUM('public', 'dept', 'private') NOT NULL DEFAULT 'public',
    `private_max` INTEGER NOT NULL DEFAULT 50,
    `claim_need_approval` BOOLEAN NOT NULL DEFAULT false,
    `assign_strategy` ENUM('manual', 'round_robin', 'region', 'industry', 'load', 'ai') NOT NULL DEFAULT 'manual',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `pool_configs_tenant_id_idx`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pool_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `action` ENUM('claim', 'assign', 'return', 'recycle', 'transfer', 'dept_assign') NOT NULL,
    `from_pool` ENUM('public', 'dept', 'private') NOT NULL,
    `to_pool` ENUM('public', 'dept', 'private') NOT NULL,
    `from_owner_id` INTEGER NULL,
    `to_owner_id` INTEGER NULL,
    `from_dept_id` INTEGER NULL,
    `to_dept_id` INTEGER NULL,
    `reason` VARCHAR(200) NULL,
    `protect_until` DATE NULL,
    `operator_id` INTEGER NOT NULL,
    `is_auto` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pool_logs_tenant_id_customer_id_idx`(`tenant_id`, `customer_id`),
    INDEX `pool_logs_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `pool_logs_operator_id_idx`(`operator_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `private_holdings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `claimed_at` DATETIME(3) NOT NULL,
    `protect_until` DATE NOT NULL,
    `last_follow_at` DATETIME(3) NULL,
    `follow_count` INTEGER NOT NULL DEFAULT 0,
    `is_expired` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `private_holdings_protect_until_idx`(`protect_until`),
    INDEX `private_holdings_tenant_id_user_id_idx`(`tenant_id`, `user_id`),
    UNIQUE INDEX `private_holdings_tenant_id_user_id_customer_id_key`(`tenant_id`, `user_id`, `customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `opportunity_stages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `sort_order` INTEGER NOT NULL,
    `probability` INTEGER NOT NULL DEFAULT 0,
    `stall_threshold_days` INTEGER NOT NULL DEFAULT 30,
    `entry_criteria` TEXT NULL,
    `exit_actions` TEXT NULL,
    `required_fields` JSON NULL,
    `is_won` BOOLEAN NOT NULL DEFAULT false,
    `is_lost` BOOLEAN NOT NULL DEFAULT false,
    `color` VARCHAR(10) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `opportunity_stages_tenant_id_sort_order_idx`(`tenant_id`, `sort_order`),
    UNIQUE INDEX `opportunity_stages_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `opportunities` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `contact_id` INTEGER NULL,
    `lead_id` INTEGER NULL,
    `partner_id` INTEGER NULL,
    `owner_id` INTEGER NOT NULL,
    `team_ids` JSON NULL,
    `stage` VARCHAR(30) NOT NULL DEFAULT 'intention',
    `stage_entered_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `stage_history` JSON NULL,
    `amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `weighted_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `expected_close_date` DATE NULL,
    `expected_revenue_year` INTEGER NULL,
    `product_ids` JSON NULL,
    `demand_summary` TEXT NULL,
    `source` VARCHAR(50) NULL,
    `competitor_ids` JSON NULL,
    `competitor_note` TEXT NULL,
    `priority` ENUM('high', 'medium', 'low') NOT NULL DEFAULT 'medium',
    `is_key` BOOLEAN NOT NULL DEFAULT false,
    `health_score` INTEGER NULL,
    `health_factors` JSON NULL,
    `health_level` ENUM('green', 'yellow', 'red') NULL,
    `status` ENUM('open', 'won', 'lost', 'cancelled', 'on_hold') NOT NULL DEFAULT 'open',
    `win_date` DATE NULL,
    `loss_reason` VARCHAR(30) NULL,
    `loss_detail` VARCHAR(500) NULL,
    `contract_id` INTEGER NULL,
    `project_id` INTEGER NULL,
    `next_action` VARCHAR(200) NULL,
    `next_action_date` DATE NULL,
    `last_follow_at` DATETIME(3) NULL,
    `follow_count` INTEGER NOT NULL DEFAULT 0,
    `stage_stall_days` INTEGER NOT NULL DEFAULT 0,
    `remark` TEXT NULL,
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `opportunities_tenant_id_owner_id_idx`(`tenant_id`, `owner_id`),
    INDEX `opportunities_tenant_id_customer_id_idx`(`tenant_id`, `customer_id`),
    INDEX `opportunities_tenant_id_stage_idx`(`tenant_id`, `stage`),
    INDEX `opportunities_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `opportunities_expected_close_date_idx`(`expected_close_date`),
    INDEX `opportunities_health_level_idx`(`health_level`),
    UNIQUE INDEX `opportunities_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `opportunity_products` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `opportunity_id` INTEGER NOT NULL,
    `product_id` INTEGER NULL,
    `product_name` VARCHAR(200) NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `estimated_price` DECIMAL(12, 2) NULL,
    `estimated_amount` DECIMAL(15, 2) NULL,
    `remark` VARCHAR(200) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `opportunity_products_opportunity_id_idx`(`opportunity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `opportunity_reviews` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `opportunity_id` INTEGER NOT NULL,
    `review_type` ENUM('stage_gate', 'weekly', 'special') NOT NULL,
    `reviewer_id` INTEGER NOT NULL,
    `result` ENUM('pass', 'hold', 'reject', 'escalate') NOT NULL,
    `comments` TEXT NULL,
    `action_items` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `opportunity_reviews_opportunity_id_idx`(`opportunity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `follow_ups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `target_type` VARCHAR(20) NOT NULL,
    `target_id` INTEGER NOT NULL,
    `customer_id` INTEGER NULL,
    `method` ENUM('visit', 'phone', 'wechat', 'email', 'meeting', 'other') NOT NULL,
    `content` TEXT NOT NULL,
    `contact_id` INTEGER NULL,
    `result` VARCHAR(50) NULL,
    `next_action` VARCHAR(200) NULL,
    `next_follow_at` DATETIME(3) NULL,
    `attachment_ids` JSON NULL,
    `ai_structured` JSON NULL,
    `created_by` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `follow_ups_tenant_id_target_type_target_id_idx`(`tenant_id`, `target_type`, `target_id`),
    INDEX `follow_ups_tenant_id_customer_id_idx`(`tenant_id`, `customer_id`),
    INDEX `follow_ups_tenant_id_created_by_idx`(`tenant_id`, `created_by`),
    INDEX `follow_ups_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `action_plans` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `target_type` VARCHAR(20) NOT NULL,
    `target_id` INTEGER NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `content` TEXT NULL,
    `action_type` VARCHAR(20) NOT NULL DEFAULT 'other',
    `assignee_id` INTEGER NOT NULL,
    `priority` ENUM('urgent', 'high', 'medium', 'low') NOT NULL DEFAULT 'medium',
    `due_date` DATE NULL,
    `due_time` VARCHAR(5) NULL,
    `status` ENUM('pending', 'in_progress', 'completed', 'overdue', 'cancelled') NOT NULL DEFAULT 'pending',
    `completed_at` DATETIME(3) NULL,
    `source` ENUM('manual', 'ai_recommend', 'system', 'meeting') NOT NULL DEFAULT 'manual',
    `reminder_sent` BOOLEAN NOT NULL DEFAULT false,
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `action_plans_tenant_id_target_type_target_id_idx`(`tenant_id`, `target_type`, `target_id`),
    INDEX `action_plans_tenant_id_assignee_id_status_idx`(`tenant_id`, `assignee_id`, `status`),
    INDEX `action_plans_due_date_idx`(`due_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `code` VARCHAR(50) NULL,
    `category` VARCHAR(50) NOT NULL,
    `sub_category` VARCHAR(50) NULL,
    `description` TEXT NULL,
    `specification` VARCHAR(200) NULL,
    `unit` VARCHAR(20) NOT NULL DEFAULT '个',
    `list_price` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `partner_price` DECIMAL(12, 2) NULL,
    `cost_price` DECIMAL(12, 2) NULL,
    `tax_rate` DECIMAL(5, 2) NOT NULL DEFAULT 13,
    `yonyou_product_code` VARCHAR(50) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `products_tenant_id_category_idx`(`tenant_id`, `category`),
    INDEX `products_code_idx`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contract_templates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `contract_type` ENUM('software_sale', 'implementation', 'maintenance', 'outsource', 'ai_fde', 'saas_sub', 'channel') NOT NULL,
    `file_url` VARCHAR(500) NULL,
    `milestone_template_id` INTEGER NULL,
    `default_payment_terms` VARCHAR(200) NULL,
    `default_tax_rate` DECIMAL(5, 2) NULL DEFAULT 13,
    `variables` JSON NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `contract_templates_tenant_id_contract_type_idx`(`tenant_id`, `contract_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contracts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `contract_no` VARCHAR(30) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `opportunity_id` INTEGER NULL,
    `partner_id` INTEGER NULL,
    `contract_type` ENUM('software_sale', 'implementation', 'maintenance', 'outsource', 'ai_fde', 'saas_sub', 'channel') NOT NULL,
    `template_id` INTEGER NULL,
    `amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `amount_excl_tax` DECIMAL(15, 2) NULL,
    `tax_rate` DECIMAL(5, 2) NULL DEFAULT 13,
    `tax_amount` DECIMAL(15, 2) NULL,
    `currency` VARCHAR(10) NOT NULL DEFAULT 'CNY',
    `discount_rate` DECIMAL(5, 2) NULL,
    `sign_date` DATE NULL,
    `start_date` DATE NULL,
    `end_date` DATE NULL,
    `duration_months` INTEGER NULL,
    `payment_terms` VARCHAR(200) NULL,
    `status` ENUM('draft', 'pending_approval', 'approved', 'rejected', 'signed', 'executing', 'completed', 'terminated', 'expired') NOT NULL DEFAULT 'draft',
    `approval_id` INTEGER NULL,
    `signed_by_customer` VARCHAR(50) NULL,
    `signed_by_us` VARCHAR(50) NULL,
    `e_sign_id` VARCHAR(100) NULL,
    `e_sign_status` ENUM('pending', 'sent', 'signed', 'expired', 'revoked') NULL,
    `seal_type` ENUM('company', 'contract', 'finance') NULL,
    `owner_id` INTEGER NOT NULL,
    `project_id` INTEGER NULL,
    `parent_contract_id` INTEGER NULL,
    `renew_count` INTEGER NOT NULL DEFAULT 0,
    `milestone_template_id` INTEGER NULL,
    `total_invoiced` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `total_received` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `total_outstanding` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `attachments` JSON NULL,
    `remark` TEXT NULL,
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `contracts_tenant_id_customer_id_idx`(`tenant_id`, `customer_id`),
    INDEX `contracts_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `contracts_tenant_id_owner_id_idx`(`tenant_id`, `owner_id`),
    INDEX `contracts_end_date_idx`(`end_date`),
    INDEX `contracts_tenant_id_contract_type_idx`(`tenant_id`, `contract_type`),
    UNIQUE INDEX `contracts_tenant_id_contract_no_key`(`tenant_id`, `contract_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contract_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `contract_id` INTEGER NOT NULL,
    `product_id` INTEGER NULL,
    `item_name` VARCHAR(200) NOT NULL,
    `item_type` ENUM('software', 'service', 'hardware', 'subscription', 'other') NOT NULL DEFAULT 'service',
    `specification` VARCHAR(200) NULL,
    `quantity` DECIMAL(10, 2) NOT NULL DEFAULT 1,
    `unit` VARCHAR(20) NULL,
    `unit_price` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `list_price` DECIMAL(12, 2) NULL,
    `discount_rate` DECIMAL(5, 2) NULL,
    `amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `tax_rate` DECIMAL(5, 2) NULL DEFAULT 13,
    `service_years` INTEGER NULL,
    `man_days` DECIMAL(8, 1) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `remark` VARCHAR(200) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `contract_items_contract_id_idx`(`contract_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contract_milestones` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `contract_id` INTEGER NOT NULL,
    `template_item_id` INTEGER NULL,
    `name` VARCHAR(100) NOT NULL,
    `sort_order` INTEGER NOT NULL,
    `planned_date` DATE NOT NULL,
    `actual_date` DATE NULL,
    `amount` DECIMAL(15, 2) NULL,
    `amount_ratio` DECIMAL(5, 2) NULL,
    `payment_trigger` ENUM('on_complete', 'after_days', 'manual', 'none') NOT NULL DEFAULT 'on_complete',
    `payment_days_after` INTEGER NOT NULL DEFAULT 0,
    `deliverables` TEXT NULL,
    `owner_id` INTEGER NULL,
    `status` ENUM('pending', 'in_progress', 'completed', 'delayed', 'cancelled') NOT NULL DEFAULT 'pending',
    `completed_by` INTEGER NULL,
    `completed_at` DATETIME(3) NULL,
    `delay_reason` VARCHAR(200) NULL,
    `invoice_triggered` BOOLEAN NOT NULL DEFAULT false,
    `payment_plan_id` INTEGER NULL,
    `attachment_ids` JSON NULL,
    `remark` VARCHAR(200) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `contract_milestones_contract_id_idx`(`contract_id`),
    INDEX `contract_milestones_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `contract_milestones_planned_date_idx`(`planned_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contract_changes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `contract_id` INTEGER NOT NULL,
    `change_type` ENUM('amount', 'scope', 'schedule', 'terms', 'terminate', 'renew') NOT NULL,
    `before_value` TEXT NOT NULL,
    `after_value` TEXT NOT NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    `approval_id` INTEGER NULL,
    `requested_by` INTEGER NOT NULL,
    `approved_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approved_at` DATETIME(3) NULL,

    INDEX `contract_changes_contract_id_idx`(`contract_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `order_no` VARCHAR(30) NOT NULL,
    `contract_id` INTEGER NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `opportunity_id` INTEGER NULL,
    `order_type` ENUM('standard', 'supplement', 'change', 'return') NOT NULL DEFAULT 'standard',
    `status` ENUM('draft', 'pending_approval', 'approved', 'confirmed', 'shipping', 'delivered', 'completed', 'cancelled') NOT NULL DEFAULT 'draft',
    `total_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `total_tax` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `total_amount_incl_tax` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `discount_rate` DECIMAL(5, 2) NULL,
    `currency` VARCHAR(10) NOT NULL DEFAULT 'CNY',
    `order_date` DATE NOT NULL,
    `expected_delivery_date` DATE NULL,
    `actual_delivery_date` DATE NULL,
    `delivery_address` VARCHAR(300) NULL,
    `delivery_method` ENUM('online', 'express', 'onsite', 'email') NULL,
    `receiver_name` VARCHAR(50) NULL,
    `receiver_phone` VARCHAR(200) NULL,
    `owner_id` INTEGER NOT NULL,
    `approval_id` INTEGER NULL,
    `credit_check_result` ENUM('pass', 'blocked', 'override') NULL,
    `credit_override_reason` VARCHAR(200) NULL,
    `yonyou_order_no` VARCHAR(50) NULL,
    `yonyou_sync_status` ENUM('pending', 'synced', 'failed', 'manual') NOT NULL DEFAULT 'pending',
    `yonyou_sync_at` DATETIME(3) NULL,
    `invoice_triggered` BOOLEAN NOT NULL DEFAULT false,
    `project_triggered` BOOLEAN NOT NULL DEFAULT false,
    `remark` TEXT NULL,
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `orders_tenant_id_contract_id_idx`(`tenant_id`, `contract_id`),
    INDEX `orders_tenant_id_customer_id_idx`(`tenant_id`, `customer_id`),
    INDEX `orders_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `orders_tenant_id_order_no_key`(`tenant_id`, `order_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `order_id` INTEGER NOT NULL,
    `product_id` INTEGER NULL,
    `item_name` VARCHAR(200) NOT NULL,
    `item_type` ENUM('software', 'service', 'hardware', 'subscription', 'other') NOT NULL,
    `specification` VARCHAR(200) NULL,
    `quantity` DECIMAL(10, 2) NOT NULL DEFAULT 1,
    `unit` VARCHAR(20) NULL,
    `unit_price` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `list_price` DECIMAL(12, 2) NULL,
    `discount_rate` DECIMAL(5, 2) NULL,
    `amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `tax_rate` DECIMAL(5, 2) NULL DEFAULT 13,
    `tax_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `price_source` ENUM('rule', 'policy', 'list', 'manual') NOT NULL DEFAULT 'list',
    `manual_adjusted` BOOLEAN NOT NULL DEFAULT false,
    `delivered_qty` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `invoiced_qty` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `remark` VARCHAR(200) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `order_items_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_deliveries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `order_id` INTEGER NOT NULL,
    `delivery_type` ENUM('ship', 'receive', 'install') NOT NULL,
    `delivery_date` DATE NOT NULL,
    `tracking_no` VARCHAR(50) NULL,
    `carrier` VARCHAR(50) NULL,
    `items` JSON NULL,
    `receiver_confirm` BOOLEAN NOT NULL DEFAULT false,
    `confirmed_by` VARCHAR(50) NULL,
    `confirmed_at` DATETIME(3) NULL,
    `license_key` TEXT NULL,
    `attachment_ids` JSON NULL,
    `operator_id` INTEGER NOT NULL,
    `remark` VARCHAR(200) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `order_deliveries_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `invoice_no` VARCHAR(30) NOT NULL,
    `contract_id` INTEGER NOT NULL,
    `order_id` INTEGER NULL,
    `milestone_id` INTEGER NULL,
    `customer_id` INTEGER NOT NULL,
    `invoice_type` ENUM('special', 'normal', 'electronic') NOT NULL DEFAULT 'special',
    `direction` ENUM('output', 'input') NOT NULL DEFAULT 'output',
    `amount` DECIMAL(15, 2) NOT NULL,
    `amount_excl_tax` DECIMAL(15, 2) NOT NULL,
    `tax_rate` DECIMAL(5, 2) NOT NULL DEFAULT 13,
    `tax_amount` DECIMAL(15, 2) NOT NULL,
    `invoice_title` VARCHAR(200) NOT NULL,
    `tax_no` VARCHAR(20) NOT NULL,
    `bank_name` VARCHAR(100) NULL,
    `bank_account` VARCHAR(200) NULL,
    `address` VARCHAR(200) NULL,
    `phone` VARCHAR(20) NULL,
    `content` VARCHAR(200) NULL,
    `real_invoice_no` VARCHAR(50) NULL,
    `real_invoice_code` VARCHAR(50) NULL,
    `invoice_date` DATE NULL,
    `status` ENUM('pending', 'invoiced', 'sent', 'received', 'verified', 'voided', 'red_flushed') NOT NULL DEFAULT 'pending',
    `delivery_method` ENUM('email', 'express', 'onsite') NULL,
    `tracking_no` VARCHAR(50) NULL,
    `sent_date` DATE NULL,
    `received_date` DATE NULL,
    `verify_result` ENUM('valid', 'invalid', 'not_found') NULL,
    `verify_at` DATETIME(3) NULL,
    `verify_api` VARCHAR(20) NULL,
    `red_flush_reason` VARCHAR(200) NULL,
    `red_flush_invoice_id` INTEGER NULL,
    `approval_id` INTEGER NULL,
    `yonyou_sync_status` ENUM('pending', 'synced', 'failed', 'manual') NOT NULL DEFAULT 'pending',
    `attachment_ids` JSON NULL,
    `remark` TEXT NULL,
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `invoices_contract_id_idx`(`contract_id`),
    INDEX `invoices_tenant_id_customer_id_idx`(`tenant_id`, `customer_id`),
    INDEX `invoices_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `invoices_tenant_id_invoice_no_key`(`tenant_id`, `invoice_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_plans` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `contract_id` INTEGER NOT NULL,
    `milestone_id` INTEGER NULL,
    `plan_no` VARCHAR(20) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `ratio` DECIMAL(5, 2) NULL,
    `due_date` DATE NOT NULL,
    `trigger_condition` VARCHAR(200) NULL,
    `status` ENUM('pending', 'partial', 'completed', 'overdue', 'cancelled') NOT NULL DEFAULT 'pending',
    `received_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `outstanding_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `overdue_days` INTEGER NOT NULL DEFAULT 0,
    `invoice_required` BOOLEAN NOT NULL DEFAULT false,
    `invoice_id` INTEGER NULL,
    `reminded` BOOLEAN NOT NULL DEFAULT false,
    `remind_at` DATETIME(3) NULL,
    `remark` VARCHAR(200) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `payment_plans_contract_id_idx`(`contract_id`),
    INDEX `payment_plans_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `payment_plans_due_date_idx`(`due_date`),
    INDEX `payment_plans_tenant_id_overdue_days_idx`(`tenant_id`, `overdue_days`),
    UNIQUE INDEX `payment_plans_tenant_id_plan_no_key`(`tenant_id`, `plan_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `receipts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `receipt_no` VARCHAR(30) NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `contract_id` INTEGER NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `allocated_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `unallocated_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `receipt_date` DATE NOT NULL,
    `method` ENUM('bank_transfer', 'check', 'cash', 'online', 'bill') NOT NULL DEFAULT 'bank_transfer',
    `bank_account` VARCHAR(200) NULL,
    `serial_no` VARCHAR(50) NULL,
    `payer_name` VARCHAR(200) NULL,
    `status` ENUM('draft', 'confirmed', 'voided') NOT NULL DEFAULT 'draft',
    `confirmed_by` INTEGER NULL,
    `confirmed_at` DATETIME(3) NULL,
    `void_reason` VARCHAR(200) NULL,
    `voided_at` DATETIME(3) NULL,
    `yonyou_voucher_no` VARCHAR(50) NULL,
    `yonyou_sync_status` ENUM('pending', 'synced', 'failed', 'manual') NOT NULL DEFAULT 'pending',
    `attachment_ids` JSON NULL,
    `remark` TEXT NULL,
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `receipts_tenant_id_customer_id_idx`(`tenant_id`, `customer_id`),
    INDEX `receipts_contract_id_idx`(`contract_id`),
    INDEX `receipts_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `receipts_receipt_date_idx`(`receipt_date`),
    UNIQUE INDEX `receipts_tenant_id_receipt_no_key`(`tenant_id`, `receipt_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `receipt_allocations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `receipt_id` INTEGER NOT NULL,
    `payment_plan_id` INTEGER NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `allocated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `allocated_by` INTEGER NOT NULL,
    `remark` VARCHAR(200) NULL,

    INDEX `receipt_allocations_payment_plan_id_idx`(`payment_plan_id`),
    UNIQUE INDEX `receipt_allocations_receipt_id_payment_plan_id_key`(`receipt_id`, `payment_plan_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `collection_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `contract_id` INTEGER NULL,
    `payment_plan_id` INTEGER NULL,
    `action_type` ENUM('system_remind', 'phone', 'email', 'wechat', 'visit', 'letter') NOT NULL,
    `content` TEXT NULL,
    `result` ENUM('promised', 'partial', 'refused', 'no_response', 'dispute') NULL,
    `promised_date` DATE NULL,
    `promised_amount` DECIMAL(15, 2) NULL,
    `operator_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `collection_logs_tenant_id_customer_id_idx`(`tenant_id`, `customer_id`),
    INDEX `collection_logs_payment_plan_id_idx`(`payment_plan_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `projects` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `project_no` VARCHAR(30) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `contract_id` INTEGER NULL,
    `customer_id` INTEGER NOT NULL,
    `opportunity_id` INTEGER NULL,
    `project_type` ENUM('implementation', 'outsource', 'maintenance', 'ai_fde', 'saas_deploy', 'other') NOT NULL DEFAULT 'implementation',
    `stage` ENUM('initiation', 'blueprint', 'development', 'testing', 'go_live', 'acceptance', 'maintenance', 'closed') NOT NULL DEFAULT 'initiation',
    `stage_entered_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` ENUM('pending_approval', 'active', 'on_hold', 'completed', 'cancelled') NOT NULL DEFAULT 'pending_approval',
    `pm_id` INTEGER NOT NULL,
    `sales_owner_id` INTEGER NULL,
    `team_ids` JSON NULL,
    `budget_amount` DECIMAL(15, 2) NULL,
    `budget_man_days` DECIMAL(8, 1) NULL,
    `actual_man_days` DECIMAL(8, 1) NOT NULL DEFAULT 0,
    `man_day_cost` DECIMAL(10, 2) NULL DEFAULT 1500,
    `actual_cost` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `outsource_cost` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `travel_cost` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `gross_margin` DECIMAL(5, 2) NULL,
    `progress` INTEGER NOT NULL DEFAULT 0,
    `planned_start_date` DATE NOT NULL,
    `planned_end_date` DATE NOT NULL,
    `actual_start_date` DATE NULL,
    `actual_end_date` DATE NULL,
    `delay_days` INTEGER NOT NULL DEFAULT 0,
    `health_status` ENUM('green', 'yellow', 'red') NOT NULL DEFAULT 'green',
    `priority` ENUM('high', 'medium', 'low') NOT NULL DEFAULT 'medium',
    `approval_id` INTEGER NULL,
    `acceptance_date` DATE NULL,
    `acceptance_doc_id` INTEGER NULL,
    `satisfaction_score` INTEGER NULL,
    `closure_note` TEXT NULL,
    `remark` TEXT NULL,
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `projects_tenant_id_pm_id_idx`(`tenant_id`, `pm_id`),
    INDEX `projects_tenant_id_customer_id_idx`(`tenant_id`, `customer_id`),
    INDEX `projects_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `projects_contract_id_idx`(`contract_id`),
    INDEX `projects_tenant_id_stage_idx`(`tenant_id`, `stage`),
    UNIQUE INDEX `projects_tenant_id_project_no_key`(`tenant_id`, `project_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_milestones` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `project_id` INTEGER NOT NULL,
    `contract_milestone_id` INTEGER NULL,
    `name` VARCHAR(100) NOT NULL,
    `stage` VARCHAR(30) NOT NULL,
    `sort_order` INTEGER NOT NULL,
    `weight` INTEGER NOT NULL DEFAULT 0,
    `planned_date` DATE NOT NULL,
    `actual_date` DATE NULL,
    `status` ENUM('pending', 'in_progress', 'completed', 'delayed', 'cancelled') NOT NULL DEFAULT 'pending',
    `owner_id` INTEGER NULL,
    `deliverables` TEXT NULL,
    `acceptance_criteria` TEXT NULL,
    `attachment_ids` JSON NULL,
    `delay_reason` VARCHAR(200) NULL,
    `payment_triggered` BOOLEAN NOT NULL DEFAULT false,
    `completed_by` INTEGER NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `project_milestones_project_id_idx`(`project_id`),
    INDEX `project_milestones_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `project_milestones_planned_date_idx`(`planned_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `project_id` INTEGER NOT NULL,
    `milestone_id` INTEGER NULL,
    `parent_task_id` INTEGER NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `assignee_id` INTEGER NOT NULL,
    `status` ENUM('todo', 'in_progress', 'review', 'done', 'cancelled') NOT NULL DEFAULT 'todo',
    `priority` ENUM('urgent', 'high', 'medium', 'low') NOT NULL DEFAULT 'medium',
    `planned_hours` DECIMAL(6, 1) NULL,
    `actual_hours` DECIMAL(6, 1) NOT NULL DEFAULT 0,
    `due_date` DATE NULL,
    `completed_at` DATETIME(3) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `tags` JSON NULL,
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `project_tasks_project_id_idx`(`project_id`),
    INDEX `project_tasks_tenant_id_assignee_id_idx`(`tenant_id`, `assignee_id`),
    INDEX `project_tasks_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `project_tasks_milestone_id_idx`(`milestone_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `timesheets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `project_id` INTEGER NOT NULL,
    `task_id` INTEGER NULL,
    `user_id` INTEGER NOT NULL,
    `work_date` DATE NOT NULL,
    `hours` DECIMAL(4, 1) NOT NULL,
    `man_days` DECIMAL(4, 2) NOT NULL DEFAULT 0,
    `work_type` ENUM('onsite', 'remote', 'training', 'meeting', 'document') NOT NULL DEFAULT 'remote',
    `description` VARCHAR(500) NULL,
    `status` ENUM('draft', 'submitted', 'approved', 'rejected') NOT NULL DEFAULT 'draft',
    `approved_by` INTEGER NULL,
    `approved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `timesheets_project_id_idx`(`project_id`),
    INDEX `timesheets_tenant_id_user_id_idx`(`tenant_id`, `user_id`),
    INDEX `timesheets_status_idx`(`status`),
    UNIQUE INDEX `timesheets_tenant_id_user_id_work_date_project_id_task_id_key`(`tenant_id`, `user_id`, `work_date`, `project_id`, `task_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_documents` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `project_id` INTEGER NOT NULL,
    `milestone_id` INTEGER NULL,
    `category` ENUM('blueprint', 'design', 'test', 'training', 'acceptance', 'meeting', 'other') NOT NULL DEFAULT 'other',
    `name` VARCHAR(200) NOT NULL,
    `file_url` VARCHAR(500) NOT NULL,
    `file_size` BIGINT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `uploaded_by` INTEGER NOT NULL,
    `uploaded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `remark` VARCHAR(200) NULL,

    INDEX `project_documents_project_id_idx`(`project_id`),
    INDEX `project_documents_tenant_id_category_idx`(`tenant_id`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approvals` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `approval_no` VARCHAR(30) NOT NULL,
    `biz_type` VARCHAR(30) NOT NULL,
    `biz_id` INTEGER NOT NULL,
    `biz_no` VARCHAR(30) NULL,
    `title` VARCHAR(200) NOT NULL,
    `applicant_id` INTEGER NOT NULL,
    `current_node_id` INTEGER NULL,
    `status` ENUM('pending', 'approved', 'rejected', 'cancelled', 'withdrawn') NOT NULL DEFAULT 'pending',
    `form_data` JSON NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,
    `dingtalk_instance_id` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `approvals_biz_type_biz_id_idx`(`biz_type`, `biz_id`),
    INDEX `approvals_tenant_id_applicant_id_idx`(`tenant_id`, `applicant_id`),
    INDEX `approvals_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `approvals_tenant_id_approval_no_key`(`tenant_id`, `approval_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_nodes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `approval_id` INTEGER NOT NULL,
    `node_order` INTEGER NOT NULL,
    `node_name` VARCHAR(50) NOT NULL,
    `approver_id` INTEGER NOT NULL,
    `action` ENUM('pending', 'approved', 'rejected', 'transferred', 'added') NOT NULL DEFAULT 'pending',
    `comment` TEXT NULL,
    `acted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `approval_nodes_approval_id_idx`(`approval_id`),
    INDEX `approval_nodes_tenant_id_approver_id_action_idx`(`tenant_id`, `approver_id`, `action`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `milestone_templates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `contract_type` ENUM('software_sale', 'implementation', 'maintenance', 'outsource', 'ai_fde', 'saas_sub', 'channel') NOT NULL,
    `description` VARCHAR(500) NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `milestone_templates_tenant_id_contract_type_idx`(`tenant_id`, `contract_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `milestone_template_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `template_id` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `sort_order` INTEGER NOT NULL,
    `offset_days` INTEGER NOT NULL DEFAULT 0,
    `amount_ratio` DECIMAL(5, 2) NULL,
    `payment_trigger` ENUM('on_complete', 'after_days', 'manual', 'none') NOT NULL DEFAULT 'none',
    `payment_days_after` INTEGER NOT NULL DEFAULT 0,
    `deliverables` TEXT NULL,
    `default_owner_role` VARCHAR(30) NULL,
    `is_payment_node` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `milestone_template_items_template_id_idx`(`template_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `type` VARCHAR(50) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `content` TEXT NULL,
    `biz_type` VARCHAR(30) NULL,
    `biz_id` INTEGER NULL,
    `channel` ENUM('inbox', 'dingtalk', 'wecom', 'email', 'sms') NOT NULL DEFAULT 'inbox',
    `is_read` BOOLEAN NOT NULL DEFAULT false,
    `read_at` DATETIME(3) NULL,
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_tenant_id_user_id_is_read_idx`(`tenant_id`, `user_id`, `is_read`),
    INDEX `notifications_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `user_id` INTEGER NULL,
    `action` VARCHAR(50) NOT NULL,
    `object_type` VARCHAR(50) NOT NULL,
    `object_id` INTEGER NULL,
    `object_no` VARCHAR(100) NULL,
    `before_data` JSON NULL,
    `after_data` JSON NULL,
    `ip_address` VARCHAR(50) NULL,
    `user_agent` VARCHAR(300) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `audit_logs_object_type_object_id_idx`(`object_type`, `object_id`),
    INDEX `audit_logs_tenant_id_user_id_idx`(`tenant_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dictionaries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `type` VARCHAR(50) NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `extra` JSON NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `dictionaries_tenant_id_type_is_active_idx`(`tenant_id`, `type`, `is_active`),
    UNIQUE INDEX `dictionaries_tenant_id_type_code_key`(`tenant_id`, `type`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `setting_key` VARCHAR(100) NOT NULL,
    `setting_value` TEXT NOT NULL,
    `value_type` ENUM('string', 'number', 'boolean', 'json', 'array') NOT NULL DEFAULT 'string',
    `setting_group` VARCHAR(50) NOT NULL,
    `description` VARCHAR(200) NULL,
    `default_value` TEXT NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `system_settings_tenant_id_setting_group_idx`(`tenant_id`, `setting_group`),
    UNIQUE INDEX `system_settings_tenant_id_setting_key_key`(`tenant_id`, `setting_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_flows` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `biz_type` VARCHAR(30) NOT NULL,
    `condition_expr` TEXT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `approval_flows_tenant_id_biz_type_is_active_idx`(`tenant_id`, `biz_type`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_flow_nodes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `flow_id` INTEGER NOT NULL,
    `node_order` INTEGER NOT NULL,
    `node_name` VARCHAR(50) NOT NULL,
    `approver_type` ENUM('role', 'user', 'dept_leader', 'applicant_leader') NOT NULL,
    `approver_value` VARCHAR(100) NULL,
    `condition_expr` TEXT NULL,
    `is_required` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `approval_flow_nodes_flow_id_node_order_idx`(`flow_id`, `node_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_audit_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `scene` VARCHAR(30) NOT NULL,
    `user_id` INTEGER NULL,
    `target_type` VARCHAR(30) NULL,
    `target_id` INTEGER NULL,
    `model_used` VARCHAR(50) NULL,
    `input_tokens` INTEGER NOT NULL DEFAULT 0,
    `output_tokens` INTEGER NOT NULL DEFAULT 0,
    `cost` DECIMAL(8, 4) NOT NULL DEFAULT 0,
    `input_summary` TEXT NULL,
    `output_summary` TEXT NULL,
    `output_full` JSON NULL,
    `adopted` BOOLEAN NULL,
    `feedback` VARCHAR(500) NULL,
    `latency_ms` INTEGER NULL,
    `status` ENUM('success', 'failed', 'timeout', 'degraded') NOT NULL DEFAULT 'success',
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_audit_logs_tenant_id_scene_created_at_idx`(`tenant_id`, `scene`, `created_at`),
    INDEX `ai_audit_logs_target_type_target_id_idx`(`target_type`, `target_id`),
    INDEX `ai_audit_logs_tenant_id_user_id_idx`(`tenant_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_rules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `event_name` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `channels` JSON NOT NULL,
    `receivers` JSON NOT NULL,
    `condition_expr` TEXT NULL,
    `template_codes` JSON NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `quiet_hours_start` VARCHAR(5) NOT NULL DEFAULT '22:00',
    `quiet_hours_end` VARCHAR(5) NOT NULL DEFAULT '08:00',
    `dedup_hours` INTEGER NOT NULL DEFAULT 24,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `notification_rules_tenant_id_event_name_is_active_idx`(`tenant_id`, `event_name`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_templates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `channel` ENUM('inbox', 'dingtalk', 'wecom', 'email', 'sms') NOT NULL,
    `title_template` VARCHAR(200) NOT NULL,
    `body_template` TEXT NOT NULL,
    `action_url_template` VARCHAR(300) NULL,
    `variables` JSON NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT true,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `notification_templates_tenant_id_code_channel_key`(`tenant_id`, `code`, `channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `files` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `biz_type` VARCHAR(50) NULL,
    `biz_id` INTEGER NULL,
    `original_name` VARCHAR(200) NOT NULL,
    `stored_name` VARCHAR(200) NOT NULL,
    `file_url` VARCHAR(500) NOT NULL,
    `file_size` BIGINT NOT NULL DEFAULT 0,
    `mime_type` VARCHAR(100) NULL,
    `extension` VARCHAR(10) NULL,
    `uploaded_by` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `files_tenant_id_biz_type_biz_id_idx`(`tenant_id`, `biz_type`, `biz_id`),
    INDEX `files_uploaded_by_idx`(`uploaded_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `credit_check_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `order_id` INTEGER NULL,
    `doc_type` VARCHAR(20) NOT NULL DEFAULT 'order',
    `doc_no` VARCHAR(30) NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `credit_limit` DECIMAL(15, 2) NOT NULL,
    `used_before` DECIMAL(15, 2) NOT NULL,
    `available` DECIMAL(15, 2) NOT NULL,
    `exceed_amount` DECIMAL(15, 2) NULL,
    `result` ENUM('pass', 'blocked', 'override') NOT NULL,
    `override_reason` VARCHAR(200) NULL,
    `operator_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `credit_check_logs_tenant_id_customer_id_idx`(`tenant_id`, `customer_id`),
    INDEX `credit_check_logs_order_id_idx`(`order_id`),
    INDEX `credit_check_logs_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `departments` ADD CONSTRAINT `departments_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `departments` ADD CONSTRAINT `departments_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_dept_id_fkey` FOREIGN KEY (`dept_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `roles` ADD CONSTRAINT `roles_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contacts` ADD CONSTRAINT `contacts_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_addresses` ADD CONSTRAINT `customer_addresses_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_banks` ADD CONSTRAINT `customer_banks_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_invoices_info` ADD CONSTRAINT `customer_invoices_info_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_converted_customer_id_fkey` FOREIGN KEY (`converted_customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_follow_ups` ADD CONSTRAINT `lead_follow_ups_lead_id_fkey` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `opportunities` ADD CONSTRAINT `opportunities_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `opportunity_products` ADD CONSTRAINT `opportunity_products_opportunity_id_fkey` FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `opportunity_reviews` ADD CONSTRAINT `opportunity_reviews_opportunity_id_fkey` FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contracts` ADD CONSTRAINT `contracts_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contract_items` ADD CONSTRAINT `contract_items_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contract_milestones` ADD CONSTRAINT `contract_milestones_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contract_changes` ADD CONSTRAINT `contract_changes_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_deliveries` ADD CONSTRAINT `order_deliveries_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_plans` ADD CONSTRAINT `payment_plans_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipt_allocations` ADD CONSTRAINT `receipt_allocations_receipt_id_fkey` FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipt_allocations` ADD CONSTRAINT `receipt_allocations_payment_plan_id_fkey` FOREIGN KEY (`payment_plan_id`) REFERENCES `payment_plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `projects` ADD CONSTRAINT `projects_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_milestones` ADD CONSTRAINT `project_milestones_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_tasks` ADD CONSTRAINT `project_tasks_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timesheets` ADD CONSTRAINT `timesheets_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_documents` ADD CONSTRAINT `project_documents_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_nodes` ADD CONSTRAINT `approval_nodes_approval_id_fkey` FOREIGN KEY (`approval_id`) REFERENCES `approvals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `milestone_template_items` ADD CONSTRAINT `milestone_template_items_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `milestone_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_flow_nodes` ADD CONSTRAINT `approval_flow_nodes_flow_id_fkey` FOREIGN KEY (`flow_id`) REFERENCES `approval_flows`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
