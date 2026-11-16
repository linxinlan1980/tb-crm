import { parseBusinessPolicy,policyDigest } from './business-policy';
const p={enabled:true,notifyUserIds:[1,2,3],contractFlowId:4,autoSubmitContracts:true,fromDate:'2026-11-15'};
describe('business notifications and approval policy',()=>{
  it('binds flow, effective date and recipient configuration',()=>{
    const h=policyDigest(parseBusinessPolicy(p));
    expect(policyDigest({...p,contractFlowId:5})).not.toBe(h);
    expect(policyDigest({...p,notifyUserIds:[1,2]})).not.toBe(h);
  });
  it.each([{...p,notifyUserIds:[1,1]},{...p,notifyUserIds:[-1]},{...p,fromDate:'2026-02-31'},{...p,fromDate:'2009-12-31'},{...p,fromDate:'2061-01-01'},{...p,profile:'untrusted'},{...p,boardEnabled:true}])('rejects invalid or injected configuration',bad=>expect(()=>parseBusinessPolicy(bad)).toThrow());
});
