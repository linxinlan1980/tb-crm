ALTER TABLE contracts ADD COLUMN signing_company VARCHAR(200) NULL,
  MODIFY COLUMN contract_type ENUM('software_sale','implementation','maintenance','outsource','ai_fde','saas_sub','channel','other') NOT NULL;
ALTER TABLE payment_plans MODIFY COLUMN due_date DATE NULL;
ALTER TABLE invoices MODIFY COLUMN invoice_type ENUM('special','normal','electronic') NULL DEFAULT 'special',
  MODIFY COLUMN amount_excl_tax DECIMAL(15,2) NULL,
  MODIFY COLUMN tax_rate DECIMAL(5,2) NULL DEFAULT 13,
  MODIFY COLUMN tax_amount DECIMAL(15,2) NULL,
  MODIFY COLUMN tax_no VARCHAR(20) NULL;
ALTER TABLE receipts MODIFY COLUMN method ENUM('bank_transfer','check','cash','online','bill') NULL DEFAULT 'bank_transfer';
CREATE TABLE source_archives (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  filename VARCHAR(200) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  size INTEGER NOT NULL,
  content_bytes MEDIUMBLOB NOT NULL,
  sheets JSON NOT NULL,
  row_count INTEGER NOT NULL,
  summary JSON NULL,
  created_by INTEGER NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY source_archives_tenant_id_sha256_key (tenant_id, sha256),
  KEY source_archives_tenant_id_created_at_idx (tenant_id, created_at)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
