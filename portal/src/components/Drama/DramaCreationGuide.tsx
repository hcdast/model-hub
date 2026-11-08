import { useState } from 'react';
import { Button, Checkbox, Modal, Tag } from 'antd';
import type { DramaProject } from '../../services/drama-api';
import { dramaGuide, type GuideAction } from '../../../../src/short-drama/drama-guide';

export default function DramaCreationGuide({project,disabled,act,preferences,openBudget,openChecks,openVersions}: {
  project:DramaProject;disabled:boolean;act:(action:GuideAction)=>void;
  preferences:(patch:Partial<{paused:boolean;narration:boolean}>)=>void;
  openBudget:()=>void;openChecks:()=>void;openVersions:()=>void;
}) {
  const [overview,setOverview]=useState(false);
  const guide=dramaGuide(project),paused=project.plan.guide?.paused===true;
  return <section className="sd-command-bar" aria-label="制作状态与下一步">
    <div className="sd-command-next"><span className="sd-eyebrow">{paused?'手动制作':'建议下一步'}</span><strong>{paused?'按自己的节奏编辑，后台任务继续运行':guide.next.title}</strong>
      {!paused && <Button size="small" type="text" disabled={disabled || guide.next.action.type==='wait'} onClick={()=>act(guide.next.action)}>前往处理</Button>}
    </div>
    <div className="sd-command-tools"><Button size="small" onClick={()=>setOverview(true)}>五步计划</Button><Button size="small" onClick={openBudget}>任务 {guide.active} · 剩余 {project.budget?.remaining ?? '—'} 积分</Button><Button size="small" onClick={openChecks}>制作检查{guide.stale ? ` · ${guide.stale} 项复核` : ''}</Button><Button size="small" onClick={openVersions}>成片版本 {guide.exports}</Button></div>
    <Modal open={overview} title="你的短剧制作计划" width={680} onCancel={()=>setOverview(false)} footer={<Button onClick={()=>setOverview(false)}>返回编辑</Button>}>
      <div className="drama-studio sd-plan-overview"><p className="sd-note">每一步按已保存的设定和选片检查。历史成片与当前草稿分别保留，编辑不会改变已经导出的文件。</p>
        <ol className="sd-guide-stages">{guide.stages.map((stage,i)=><li key={stage.title} className={stage.done?'complete':''}><span aria-hidden="true">{stage.done?'✓':i+1}</span><div><strong>{['写故事','定角色','看分镜','做视频','出成片'][i]}</strong><p>{stage.detail}</p></div><Tag>{stage.done?'已就绪':i===4?'待检查 / 导出':'待完成'}</Tag><Button size="small" disabled={disabled} onClick={()=>{setOverview(false);act({type:'open',step:stage.step});}}>前往</Button></li>)}</ol>
        <p>{guide.next.detail}</p><Checkbox disabled={disabled} checked={project.plan.guide?.narration!==false} onChange={e=>preferences({narration:e.target.checked})}>建议步骤包含旁白制作（空台词保持静音）</Checkbox>
        <Button disabled={disabled} onClick={()=>preferences({paused:!paused})}>{paused?'开启下一步建议':'切换为手动制作'}</Button><p className="sd-note">手动模式只关闭下一步建议；已提交的任务继续运行，需要停止时请到任务面板逐项取消。</p>
      </div>
    </Modal>
  </section>;
}
