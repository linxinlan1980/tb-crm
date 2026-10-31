import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DictionaryService } from './dictionary.service';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { TenantId } from '../../../common/decorators/current-user.decorator';

@ApiTags('系统管理-数据字典')
@ApiBearerAuth()
@Controller('system/dictionaries')
export class DictionaryController {
  constructor(private readonly dictService: DictionaryService) {}

  @Get('types')
  @ApiOperation({ summary: '获取所有字典类型' })
  findTypes(@TenantId() tid: number) {
    return this.dictService.findTypes(tid);
  }

  @Get()
  @ApiOperation({ summary: '按类型获取字典列表' })
  findByType(@TenantId() tid: number, @Query('type') type: string) {
    return this.dictService.findByType(tid, type);
  }

  @Post()
  @Permissions('system:dictionary')
  @ApiOperation({ summary: '创建字典项' })
  create(@TenantId() tid: number, @Body() dto: any) {
    return this.dictService.create(tid, dto);
  }

  @Put(':id')
  @Permissions('system:dictionary')
  @ApiOperation({ summary: '更新字典项' })
  update(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.dictService.update(tid, id, dto);
  }

  @Delete(':id')
  @Permissions('system:dictionary')
  @ApiOperation({ summary: '删除字典项' })
  remove(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number) {
    return this.dictService.remove(tid, id);
  }
}
