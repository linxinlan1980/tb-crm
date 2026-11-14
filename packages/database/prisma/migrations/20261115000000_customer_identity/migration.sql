-- Nullable identity keys preserve legacy records. New writes normalize and check
-- legacy values under the tenant lock; no existing customers are silently merged.
ALTER TABLE `customers` ADD COLUMN `company_phone` VARCHAR(50) NULL,
 ADD COLUMN `credit_fingerprint` CHAR(64) NULL;
CREATE UNIQUE INDEX `customers_tenant_credit_key` ON `customers` (`tenant_id`, `credit_fingerprint`);
