ALTER TABLE customers ADD COLUMN customer_category VARCHAR(20) NOT NULL DEFAULT 'direct', ADD COLUMN channel_brand VARCHAR(50) NULL;
ALTER TABLE calendar_entries ADD COLUMN origin VARCHAR(20) NOT NULL DEFAULT 'crm', ADD COLUMN external_id VARCHAR(200) NULL, ADD COLUMN external_snapshot JSON NULL;
CREATE UNIQUE INDEX calendar_entries_tenant_id_owner_id_external_id_key ON calendar_entries(tenant_id, owner_id, external_id);
ALTER TABLE approval_nodes MODIFY COLUMN action ENUM('pending','approved','rejected','transferred','added','skipped') NOT NULL DEFAULT 'pending';
ALTER TABLE approval_flow_nodes MODIFY COLUMN approver_type ENUM('role','user','dept_leader','applicant_leader','users_all','users_any') NOT NULL;
