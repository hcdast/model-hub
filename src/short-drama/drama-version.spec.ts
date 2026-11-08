import { emptyDramaPlan, type DramaCandidate } from './drama.types';
import { renderManifest, renderDifferences, exportVersionState } from './drama-version';

describe('Frozen export versions',()=>{
  const plan=()=>({...emptyDramaPlan(),shots:[{id:'s',title:'门',description:'门口',narration:'你好',duration:5,characterIds:[],video:'v',voice:'a'}]});
  it('ignores editor navigation, titles, prompt/model settings and unrendered references',()=>{
    const p=plan(),source={revision:3,manifest:renderManifest(p)};
    const edited={...p,title:'改名',step:4,story:'新故事',production:{provider:'test',models:{video:'other'}},shots:p.shots.map(s=>({...s,title:'换标题',description:'换提示词',image:'new'}))};
    expect(renderDifferences(edited,source)).toEqual([]);
    const noCaptions={...p,settings:{...p.settings,subtitles:false}};
    expect(renderDifferences({...noCaptions,shots:noCaptions.shots.map(s=>({...s,narration:'不参与输出的文字'}))},
      {revision:4,manifest:renderManifest(noCaptions)})).toEqual([]);
  });
  it('identifies selections, order, subtitles, output and audio changes while preserving old snapshots',()=>{
    const p=plan(),source={revision:3,manifest:renderManifest(p)};
    const edited={...p,frame:{ratio:'16:9' as const,fit:'cover' as const,voiceVolume:80},settings:{...p.settings,music:'m',musicVolume:20},shots:p.shots.map(s=>({...s,video:'v2',narration:'新字幕'}))};
    expect(renderDifferences(edited,source)).toHaveLength(4);expect(source.manifest.shots[0].video).toBe('v');
    expect(renderDifferences(p,source)).toEqual([]);
  });
  it('never calls legacy, failed or pending files a completed current version; finds any matching successful version',()=>{
    const p=plan(),base={id:'old',projectId:'p',kind:'export',targetId:'project',source:'render',status:'succeeded',url:'https://example.org/film'} as DramaCandidate;
    expect(exportVersionState(p,[base]).status).toBe('unknown');
    const current={...base,id:'new',renderSource:{revision:4,manifest:renderManifest(p)}};
    expect(exportVersionState(p,[{...current,status:'running'}]).status).toBe('none');
    const changed={...current,id:'later',renderSource:{revision:5,manifest:renderManifest({...p,settings:{...p.settings,resolution:'1080p'}})}};
    expect(exportVersionState(p,[current,changed]).matched?.id).toBe('new');
    expect(exportVersionState(p,[changed]).status).toBe('changed');
  });
});
