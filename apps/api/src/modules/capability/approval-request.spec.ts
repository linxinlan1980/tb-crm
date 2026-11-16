import { approvalRequestInput, ApprovalRequestService } from './approval-request.service';
import type { Actor } from '../../common/types/actor';
import type { WorkspaceService } from '../workspace/workspace.service';
import type { ApprovalService } from '../approval/approval.service';
const actor:Actor={tenantId:1,userId:2,deptId:1,roles:['sales'],permissions:['approval:create'],dataScope:'self',sessionId:'synthetic'};
describe('shared human approval request adapter',()=>{
  const request={kind:'contracts',requestKey:'synthetic-request',recordId:12,expectedUpdatedAt:'2026-11-15T00:00:00.000Z',form:{}};
  it.each([{...request,tenantId:2},{...request,actorId:4},{...request,approved:true},{...request,kind:'finance'},{...request,expectedUpdatedAt:undefined}])('rejects injected identity, decisions and missing version', input=>expect(approvalRequestInput.safeParse(input).success).toBe(false));
  it('submits through the same guarded web command without deciding anything',async()=>{
    const command=jest.fn().mockResolvedValue({id:12,status:'pending_approval'}),create=jest.fn();
    const s=new ApprovalRequestService({command} as unknown as WorkspaceService,{create} as unknown as ApprovalService);
    await expect(s.request(actor,request)).resolves.toEqual({id:12,status:'pending_approval'});
    expect(command).toHaveBeenCalledWith(actor,'contracts',12,'submit',{requestKey:request.requestKey,expectedUpdatedAt:request.expectedUpdatedAt,form:{}});
    expect(create).not.toHaveBeenCalled();
  });
  it('requires the same generic form creation permission as the web controller',async()=>{
    const create=jest.fn();const s=new ApprovalRequestService({} as WorkspaceService,{create} as unknown as ApprovalService);
    await expect(s.request({...actor,permissions:[]},{kind:'form',requestKey:'x',flowId:1,title:'Synthetic'})).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});
