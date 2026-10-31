-- AlterTable
ALTER TABLE `projects` MODIFY `status` ENUM('draft', 'rejected', 'pending_approval', 'active', 'on_hold', 'completed', 'cancelled') NOT NULL DEFAULT 'pending_approval';
