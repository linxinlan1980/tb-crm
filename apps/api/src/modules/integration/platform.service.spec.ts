import { PlatformService } from './platform.service';
import type { Actor } from '../../common/types/actor';
const actor:Actor={tenantId:1,userId:1,deptId:1,roles:['super_admin'],permissions:['*'],dataScope:'all'};
describe('Real-platform request boundaries',()=>{
 const original={...process.env};
 afterEach(()=>{process.env={...original};jest.restoreAllMocks();});
 function configured(){process.env.FEISHU_TENANT_ID='1';process.env.FEISHU_APP_ID='synthetic-app';process.env.FEISHU_APP_SECRET='synthetic-secret';}
 test('missing configuration never reports connected',async()=>{delete process.env.FEISHU_APP_ID;const fetch=jest.spyOn(global,'fetch');const s=new PlatformService();await expect(s.test('feishu',actor)).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();});
 test('does not use another tenant credentials',async()=>{configured();const fetch=jest.spyOn(global,'fetch');await expect(new PlatformService().test('feishu',{...actor,tenantId:2})).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();});
 test('rejects upstream failure without returning secrets',async()=>{configured();jest.spyOn(global,'fetch').mockResolvedValue(new Response(JSON.stringify({code:10003,msg:'secret token bad'}),{status:200}));await expect(new PlatformService().test('feishu',actor)).rejects.toThrow('10003');});
 test('real protocol maps a successful token response without exposing it',async()=>{configured();const fetch=jest.spyOn(global,'fetch').mockResolvedValue(new Response(JSON.stringify({code:0,tenant_access_token:'synthetic-token',expire:7200})));const result=await new PlatformService().test('feishu',actor);expect(result.connected).toBe(true);expect(JSON.stringify(result)).not.toContain('synthetic-token');expect(fetch.mock.calls[0][0]).toBe('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal');});
});
