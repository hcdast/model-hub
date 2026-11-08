import { failedProduction, generationDuration, systemGenerationField } from './drama-experience';
import { emptyDramaPlan, DramaCandidate } from './drama.types';
import { visualWarnings } from './drama-visual';
describe('Novice production and output expectations',()=>{
  it('uses compatible per-shot durations instead of a hidden five-second default',()=>{
    expect(generationDuration(8,{enum:[5,10,15]})).toBe(10);
    expect(generationDuration(12,{enum:['5','10'],type:'string'})).toBe('10');
    expect(generationDuration(3,{min:5,max:10})).toBe(5);
  });
  it('hides automatic source fields only when references exist',()=>{
    expect(systemGenerationField('image','video',true,'image')).toBe(true);
    expect(systemGenerationField('image','image',false,'image')).toBe(false);
    expect(systemGenerationField('duration','video',false)).toBe(true);
    expect(systemGenerationField('resolution','video',true)).toBe(false);
  });
  it('does not retry resolved, ready, running, stale-deleted or selected targets',()=>{
    const shot=(id:string)=>({id,title:id,description:'',narration:'你好',duration:5,characterIds:[]});
    const p={...emptyDramaPlan(),shots:['selected','ready','running','failed','stale'].map(shot)};p.shots[0]={...p.shots[0],...{video:'chosen'}};
    const c=(targetId:string,status:DramaCandidate['status'],stale=false):DramaCandidate=>({id:targetId+status,projectId:'p',kind:'video',targetId,source:'model',status,stale,url:status==='succeeded'?'https://media.example/v.mp4':undefined});
    const candidates=[...['selected','ready','running','failed','stale','deleted'].map(id=>c(id,'failed')),c('ready','succeeded'),c('running','pending'),c('stale','succeeded',true)];
    expect(failedProduction(p,candidates)).toMatchObject({total:6,actionable:2,retry:[{kind:'video',ids:['failed','stale']}]});
  });
  it('reports padding/cropping separately from actual upscaling',()=>{
    const p=emptyDramaPlan(),entry={shotId:'s',candidateId:'v',kind:'video' as const,width:640,height:360};
    expect(visualWarnings(p,entry).join(' ')).toMatch(/留边.*放大/);
    expect(visualWarnings({...p,frame:{ratio:'9:16',fit:'cover',voiceVolume:100}},entry).join(' ')).toMatch(/裁切.*放大/);
    expect(visualWarnings(p,{...entry,width:1080,height:1920})).toEqual([]);
    expect(visualWarnings(p,{...entry,error:'无法读取'})).toEqual(['无法读取']);
  });
  it('handles script candidates without media URLs and keeps adopted story failures in history',()=>{
    const p=emptyDramaPlan(),failed:DramaCandidate={id:'failed',projectId:'p',kind:'script',targetId:'project',source:'model',status:'failed'};
    expect(failedProduction(p,[failed]).retry).toEqual([{kind:'script',ids:['project']}]);
    expect(failedProduction(p,[failed,{...failed,id:'ready',status:'succeeded',text:'structured script'}]).actionable).toBe(0);
    expect(failedProduction({...p,storyConfirmed:true},[failed]).actionable).toBe(0);
  });
  it('offers a render action when no completed film exists, without classifying it as model generation',()=>{
    const p=emptyDramaPlan(),failed:DramaCandidate={id:'failed',projectId:'p',kind:'export',targetId:'project',source:'render',status:'failed'};
    expect(failedProduction(p,[failed]).retry).toEqual([{kind:'export',ids:['project']}]);
    expect(failedProduction(p,[failed,{...failed,id:'done',status:'succeeded',url:'https://media.example/done.mp4'}]).actionable).toBe(0);
  });
});
