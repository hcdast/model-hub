import { applyShotReferences, continuityRows, referenceUsage, shotReferences } from './drama-continuity';
import { emptyDramaPlan, type DramaCandidate, type DramaPlan } from './drama.types';
import { dramaFingerprint } from './drama-plan';

const plan = (): DramaPlan => ({...emptyDramaPlan(),characters:[{id:'girl',name:'小雨',description:'风衣',selected:'girl-ref'},{id:'boy',name:'小林',description:'夹克',selected:'boy-ref'}],scenes:[{id:'cafe',name:'咖啡馆',description:'木窗',selected:'cafe-ref'}],shots:[{id:'s',title:'来信',description:'推门',narration:'你好',duration:5,characterIds:['girl','boy'],sceneId:'cafe',image:'frame'}]});
const refs = (): DramaCandidate[] => [
  {id:'girl-ref',kind:'character',targetId:'girl'}, {id:'boy-ref',kind:'character',targetId:'boy'},
  {id:'cafe-ref',kind:'scene',targetId:'cafe'}, {id:'frame',kind:'image',targetId:'s'},
].map(c=>({...c,projectId:'p',source:'upload',status:'succeeded',url:`https://media.example/${c.id}`} as DramaCandidate));

describe('Drama reference continuity',()=>{
  it('keeps character order and scene last, but videos use the selected keyframe only',()=>{
    expect(shotReferences(plan(),'image','s').map(r=>r.candidateId)).toEqual(['girl-ref','boy-ref','cafe-ref']);
    expect(shotReferences(plan(),'video','s').map(r=>r.candidateId)).toEqual(['frame']);
    expect(shotReferences(plan(),'voice','s')).toEqual([]);
  });
  it('prefers multi-image fields and clearly reports capacity and omitted references',()=>{
    const selected=shotReferences(plan(),'image','s');
    expect(referenceUsage(selected,[{name:'image',type:'string'},{name:'images',type:'array',maxItems:2}])).toMatchObject({field:{name:'images'},used:selected.slice(0,2),omitted:selected.slice(2)});
    expect(referenceUsage(selected,[{name:'image',type:'string'}]).omitted.map(r=>r.name)).toEqual(['小林','咖啡馆']);
    expect(referenceUsage(selected,[{name:'prompt',type:'string'}])).toMatchObject({used:[],omitted:selected});
    expect(referenceUsage(selected,[{name:'image',type:'string'},{name:'custom_reference',type:'array',media:{kind:'image'}}]).used).toHaveLength(3);
  });
  it('uses declared media inputs and owns selected references instead of accepting overridden URLs',()=>{
    const input={image:'https://unexpected.example/override'};
    const usage=applyShotReferences(plan(),'image','s',refs(),[{name:'image',type:'string'}],input);
    expect(input.image).toBe('https://media.example/girl-ref');expect(usage.used[0].candidateId).toBe('girl-ref');
    const custom:Record<string,unknown>={image:'https://unexpected.example/default'};
    applyShotReferences(plan(),'image','s',refs(),[{name:'image',type:'string'},{name:'custom_reference',type:'array',media:{kind:'image'}}],custom);
    expect(custom.custom_reference).toHaveLength(3);
    expect(custom).not.toHaveProperty('image');
  });
  it('rejects unavailable, wrong-kind and wrong-target selected references before quoting',()=>{
    for(const patch of [{status:'failed'},{kind:'scene'},{targetId:'other'},{url:undefined}]){
      const items=refs();Object.assign(items[0],patch);
      expect(()=>applyShotReferences(plan(),'image','s',items,[{name:'images',type:'array'}],{})).toThrow('参考图不可用');
    }
  });
  it('distinguishes manual image inputs from owned role bindings and text-only requests',()=>{
    const p=plan();p.characters.forEach(r=>r.selected=undefined);p.scenes[0].selected=undefined;
    const input={images:['https://media.example/manual']};
    expect(applyShotReferences(p,'image','s',[],[{name:'images',type:'array'}],input)).toMatchObject({used:[],omitted:[],manualReferenceCount:1});
    expect(applyShotReferences(p,'image','s',[],[{name:'prompt',type:'string'}],{}).manualReferenceCount).toBe(0);
  });
  it('exposes missing references, selected stale footage and unrelated candidates correctly',()=>{
    const p=plan();p.characters[1].selected=undefined;p.shots[0].video='v';
    const items=refs();items.find(c=>c.id==='frame')!.stale=true;
    items.push({...items[0],id:'v',kind:'video',targetId:'other'});
    const row=continuityRows(p,items)[0];expect(row.missing).toEqual(['小林']);expect(row.stale.map(c=>c.id)).toEqual(['frame']);expect(row.video).toBeUndefined();
    expect(row.references.map(r=>r.name)).toEqual(['小雨','咖啡馆']);
  });
  it('only marks shots that depend on a changed role or scene as stale',()=>{
    const p=plan();p.shots.push({...p.shots[0],id:'empty',characterIds:[],sceneId:undefined});
    const before=[dramaFingerprint(p,'image','s'),dramaFingerprint(p,'video','s'),dramaFingerprint(p,'image','empty')];
    p.characters[0].selected='new-ref';
    expect(dramaFingerprint(p,'image','s')).not.toBe(before[0]);expect(dramaFingerprint(p,'video','s')).not.toBe(before[1]);expect(dramaFingerprint(p,'image','empty')).toBe(before[2]);
    const last=dramaFingerprint(p,'image','s');p.characters[0].name='小雨新名字';expect(dramaFingerprint(p,'image','s')).toBe(last);
  });
});
