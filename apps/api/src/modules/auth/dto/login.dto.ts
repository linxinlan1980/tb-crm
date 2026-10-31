import { IsString, IsNotEmpty, MinLength, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @IsOptional() @IsString() @MaxLength(30)
  tenantCode?: string;

  @ApiProperty({ example: 'linxinlan', description: '登录用户名' })
  @IsString()
  @IsNotEmpty({ message: '用户名不能为空' })
  username!: string;

  @ApiProperty({ example: 'Abc@2026', description: '密码' })
  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  @MinLength(6, { message: '密码至少6位' })
  password!: string;
}
