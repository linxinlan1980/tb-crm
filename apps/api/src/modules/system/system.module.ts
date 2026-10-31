import { Global, Module } from '@nestjs/common';
import { DepartmentController } from './departments/department.controller';
import { DepartmentService } from './departments/department.service';
import { UserController } from './users/user.controller';
import { UserService } from './users/user.service';
import { RoleController } from './roles/role.controller';
import { RoleService } from './roles/role.service';
import { DictionaryController } from './dictionaries/dictionary.controller';
import { DictionaryService } from './dictionaries/dictionary.service';
import { AuditLogController } from './audit-logs/audit-log.controller';
import { AuditLogService } from './audit-logs/audit-log.service';

@Global()
@Module({
  controllers: [DepartmentController, UserController, RoleController, DictionaryController, AuditLogController],
  providers: [DepartmentService, UserService, RoleService, DictionaryService, AuditLogService],
  exports: [UserService, RoleService, DepartmentService, AuditLogService],
})
export class SystemModule {}
