ALTER TABLE `users` ADD COLUMN `employee_no` VARCHAR(40) NULL;
CREATE UNIQUE INDEX `users_tenant_id_employee_no_key` ON `users` (`tenant_id`, `employee_no`);
CREATE INDEX `users_tenant_id_phone_idx` ON `users` (`tenant_id`, `phone`);
UPDATE `users` SET `employee_no`=CONCAT('RY',LPAD(`id`,GREATEST(6,CHAR_LENGTH(`id`)),'0')) WHERE `employee_no` IS NULL;
