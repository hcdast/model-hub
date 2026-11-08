import { dramaGuide, guideMedia } from './drama-guide';
import { renderManifest } from './drama-version';
import { emptyDramaPlan, type DramaCandidate, type DramaProject } from './drama.types';
import { normalizeDramaPlan, dramaFingerprint } from './drama-plan';

const candidate=(kind:DramaCandidate['kind'],targetId:string,id=kind+targetId,patch:Partial<DramaCandidate>={}):DramaCandidate=>({id,projectId:'p',kind,targetId,source:'model',status:'succeeded',url:'https://media.example/result',...patch});
function project():DramaProject {
  return {id:'p',revision:1,candidates:[],plan:{...emptyDramaPlan(),story:'雨后收到一封信',characters:[{id:'girl',name:'小雨',description:'短发风衣'}],shots:[{id:'s1',title:'镜头1',description:'推门',narration:'雨停了。',duration:5,characterIds:['girl']}]}};
}
function prepared() {
  const p=project();Object.assign(p.plan,{storyConfirmed:true,castConfirmed:true,storyboardConfirmed:true,step:3});
  p.plan.shots[0].image='is1';p.candidates.push(candidate('image','s1','is1'));return p;
}
describe('Beginner drama creation guide',()=>{
  it('starts at the earliest unconfirmed prerequisite even when a later editor is open',()=>{
    const p=project();p.plan.step=4;expect(dramaGuide(p).next.action).toEqual({type:'open',step:0,targetId:undefined,voice:false});
    p.plan.step=0;expect(dramaGuide(p).next.action).toEqual({type:'confirm',step:0});
    p.plan.story='';expect(dramaGuide(p).next.action.type).toBe('open');
  });
  it('requires complete cast definitions and an explicit confirmation',()=>{
    const p=project();p.plan.storyConfirmed=true;p.plan.step=1;
    expect(dramaGuide(p).next.action).toEqual({type:'confirm',step:1});
    p.plan.characters[0].description='';expect(dramaGuide(p).next.action.type).toBe('open');
  });
  it('does not treat empty arrays or storyboard flags alone as completed footage',()=>{
    const p=prepared();p.plan.shots=[];expect(dramaGuide(p).next.title).toBe('建立分镜草稿');
    const q=prepared();q.candidates=[];expect(dramaGuide(q).next.action).toEqual({type:'generate',kind:'image',ids:['s1']});
  });
  it('requires review of existing results rather than generating again',()=>{
    const p=prepared();p.candidates.push(candidate('video','s1','v1'));
    expect(dramaGuide(p).next.action).toEqual({type:'select',kind:'video',choices:[{targetId:'s1',candidateId:'v1'}]});
    p.candidates.push(candidate('video','s1','v2'));expect(dramaGuide(p).next.action).toMatchObject({type:'open',step:3,targetId:'s1'});
  });
  it('skips selected and active targets, retries failed or stale-only targets, and caps a batch at 12',()=>{
    const p=prepared();p.plan.shots=Array.from({length:16},(_,i)=>({...p.plan.shots[0],id:'s'+i,image:'i'+i}));
    p.candidates=p.plan.shots.map(s=>candidate('image',s.id,s.image));
    p.plan.shots[0].video='selected';p.candidates.push(candidate('video','s0','selected'),candidate('video','s1','running',{status:'running'}),candidate('video','s2','failed',{status:'failed'}),candidate('video','s3','stale',{stale:true}));
    const action=dramaGuide(p).next.action;expect(action).toMatchObject({type:'generate',kind:'video'});
    if(action.type!=='generate')throw Error('expected generation request');
    expect(action.ids).toHaveLength(12);expect(action.ids).not.toContain('s0');expect(action.ids).not.toContain('s1');expect(action.ids).toEqual(expect.arrayContaining(['s2','s3']));
  });
  it('waits for a replacement in flight even with an older successful candidate',()=>{
    const p=prepared();p.candidates.push(candidate('video','s1','old'),candidate('video','s1','new',{status:'running'}));
    expect(dramaGuide(p).next.action.type).toBe('wait');
  });
  it('does not mistake a wrong target, wrong kind, or missing URL for an available choice',()=>{
    const p=prepared();p.plan.shots[0].video='wrong';p.candidates.push(candidate('video','other','wrong'),candidate('image','s1','other'),candidate('video','s1','broken',{url:undefined}));
    expect(guideMedia(p.plan,p.candidates,'video').missing).toEqual(['s1']);
  });
  it('guides narration separately, allows an explicit skip, and leaves selected audio untouched',()=>{
    const p=prepared();p.plan.shots[0].video='v1';p.candidates.push(candidate('video','s1','v1'));
    expect(dramaGuide(p).next.action).toEqual({type:'generate',kind:'voice',ids:['s1']});
    p.plan.guide={paused:false,narration:false};expect(dramaGuide(p).next.action).toMatchObject({type:'open',step:4});
    p.plan.shots[0].voice='a1';expect(p.plan.shots[0].voice).toBe('a1');
  });
  it('skips empty narration and does not claim old exports match the current draft',()=>{
    const p=prepared();p.plan.shots[0].video='v1';p.plan.shots[0].narration='';p.plan.step=4;
    p.candidates.push(candidate('video','s1','v1'),candidate('export','project','film'));
    const guide=dramaGuide(p);expect(guide.next.action.type).toBe('export');expect(guide.stages).toHaveLength(5);expect(guide.stages[4].done).toBe(false);expect(guide.stages[4].detail).toContain('当前草稿');
  });
  it('shows an active export instead of submitting another render',()=>{
    const p=prepared();p.plan.shots[0].video='v1';p.plan.shots[0].narration='';p.plan.step=4;
    p.candidates.push(candidate('video','s1','v1'),candidate('export','project','film',{status:'running'}));
    expect(dramaGuide(p).next.action).toMatchObject({type:'open',step:4});
  });
  it('completes all five stages only for matching output and keeps stale captions actionable',()=>{
    const p=prepared();p.plan.shots[0].video='v1';p.plan.shots[0].narration='';p.plan.step=4;
    p.candidates.push(candidate('video','s1','v1'),candidate('export','project','film',{renderSource:{revision:1,manifest:renderManifest(p.plan)}}));
    expect(dramaGuide(p).completed).toBe(5);expect(dramaGuide(p).next.title).toBe('当前草稿已导出');
    Object.assign(p.plan.shots[0],{narration:'新文字',captions:[{start:0,end:1,text:'旧字幕'}],captionSource:{narration:'旧文字',method:'manual'}});
    p.plan.guide={paused:false,narration:false};expect(dramaGuide(p).stages[4].done).toBe(false);expect(dramaGuide(p).next.title).toBe('字幕需要重新校正');
  });
  it('prioritizes recovering an accepted request over starting a new batch',()=>{
    const p=prepared();p.pendingRequests=[{id:'quote',kind:'video',count:2}];
    expect(dramaGuide(p).next.action).toEqual({type:'resume',requestId:'quote',count:2});
  });
  it('persists only boolean preferences without changing production fingerprints or legacy defaults',()=>{
    const p=prepared().plan;const hash=dramaFingerprint(p,'video','s1');
    expect(normalizeDramaPlan(p).guide).toBeUndefined();p.guide={paused:true,narration:false};
    expect(normalizeDramaPlan({...p,guide:{...p.guide,autoSpend:true}}).guide).toEqual(p.guide);
    expect(dramaFingerprint(p,'video','s1')).toBe(hash);
    expect(()=>normalizeDramaPlan({...p,guide:{paused:'true',narration:true}})).toThrow('开关');
  });
});
