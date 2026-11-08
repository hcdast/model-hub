import { emptyDramaPlan, type DramaPlan } from './drama.types';
import { adoptScript } from './drama-script-merge';

describe('Partial script adoption',()=>{
  const original=():DramaPlan=>({...emptyDramaPlan(),story:'原故事',storyConfirmed:true,castConfirmed:true,storyboardConfirmed:true,characters:[{id:'c',name:'小雨',description:'米色风衣',selected:'portrait'}],scenes:[],shots:[{id:'s',title:'原镜头',description:'门口',narration:'你好',duration:5,characterIds:['c'],image:'i',video:'v',voice:'a'}],settings:{...emptyDramaPlan().settings,music:'m'}});
  const incoming=():DramaPlan=>({...emptyDramaPlan(),title:'新标题',story:'新故事',characters:[{id:'nc',name:'小雨',description:'红裙'},{id:'other',name:'阿明',description:'衬衣'}],shots:[{id:'n1',title:'新1',description:'窗边',narration:'新旁白',duration:5,characterIds:['nc']},{id:'n2',title:'新2',description:'街道',narration:'另一句',duration:5,characterIds:['other']}]});
  it('adopts story text without replacing selected media, roles or music',()=>{
    const p=original(),result=adoptScript(p,incoming(),{mode:'story',shots:[]});
    expect(result.plan.story).toBe('新故事');expect(result.plan.shots).toBe(p.shots);expect(result.plan.characters).toBe(p.characters);expect(result.plan.settings.music).toBe('m');expect(result.plan.storyConfirmed).toBe(false);
  });
  it('appends only checked shots, reuses original same-name roles and preserves old selections',()=>{
    const p=original(),result=adoptScript(p,incoming(),{mode:'append',shots:['n1']});
    expect(result.plan.shots.map(s=>s.id)).toEqual(['s','n1']);expect(result.plan.shots[0]).toEqual(p.shots[0]);expect(result.plan.shots[1].characterIds).toEqual(['c']);
    expect(result.plan.characters).toEqual(p.characters);expect(result.plan.story).toBe(p.story);expect(result.plan.settings.music).toBe('m');expect(result.impact.join('')).toContain('沿用原设定');
  });
  it('only imports roles referenced by appended shots and requires reconfirmation',()=>{
    const result=adoptScript(original(),incoming(),{mode:'append',shots:['n2']});
    expect(result.plan.characters.map(c=>c.id)).toEqual(['c','other']);expect(result.plan.castConfirmed).toBe(false);expect(result.plan.step).toBe(1);
  });
  it('rejects empty, duplicate and over-limit appends before changing the original',()=>{
    const p=original();expect(()=>adoptScript(p,incoming(),{mode:'append',shots:[]})).toThrow('勾选');
    const i=incoming();i.shots[0].id='s';expect(()=>adoptScript(p,i,{mode:'append',shots:['s']})).toThrow('重复');
    p.shots=Array.from({length:24},(_,i)=>({...p.shots[0],id:`s${i}`}));expect(()=>adoptScript(p,incoming(),{mode:'append',shots:['n1']})).toThrow('24');expect(p.shots).toHaveLength(24);
  });
  it('full replacement clears music and selections from parsed input but preserves production configuration',()=>{
    const p=original();p.production={provider:'akool-maas',models:{script:'llm'}};
    const result=adoptScript(p,incoming(),{mode:'replace',shots:[]});expect(result.plan.shots[0].video).toBeUndefined();expect(result.plan.settings.music).toBeUndefined();expect(result.plan.production).toEqual(p.production);expect(result.impact.join('')).toContain('清除');
  });
});
