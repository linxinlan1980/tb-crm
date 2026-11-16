import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  apiUrl: process.env.API_URL || 'http://localhost:4000',

  jwt: {
    secret: process.env.JWT_SECRET,
    privateKeyPath: process.env.JWT_PRIVATE_KEY_PATH || './keys/jwt-private.pem',
    publicKeyPath: process.env.JWT_PUBLIC_KEY_PATH || './keys/jwt-public.pem',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '2h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  encryption: {
    key: process.env.ENCRYPTION_KEY || '',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  dingtalk: {
    corpId: process.env.DINGTALK_CORP_ID || '',
    appKey: process.env.DINGTALK_APP_KEY || '',
    appSecret: process.env.DINGTALK_APP_SECRET || '',
    agentId: process.env.DINGTALK_AGENT_ID || '',
  },

  yonyou: {
    apiBase: process.env.YONYOU_API_BASE || '',
    appKey: process.env.YONYOU_APP_KEY || '',
    appSecret: process.env.YONYOU_APP_SECRET || '',
  },

  ai: {
    dashscopeApiKey: process.env.DASHSCOPE_API_KEY || '',
    defaultModel: process.env.AI_DEFAULT_MODEL || 'qwen-max',
    fallbackModel: process.env.AI_FALLBACK_MODEL || 'qwen-plus',
  },

  oss: {
    region: process.env.OSS_REGION || 'oss-cn-hangzhou',
    bucket: process.env.OSS_BUCKET || 'partneros-crm',
    accessKeyId: process.env.OSS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || '',
  },
}));
