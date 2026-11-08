import { dramaPrompt } from './drama.service';
import { emptyDramaPlan } from './drama.types';

describe('Single-shot production prompts', () => {
  it('translates the comic product label into one visual frame without sending dialogue as image text', () => {
    const plan = {...emptyDramaPlan(),characters:[{id:'c',name:'小雨',description:'短发，米色风衣'}],shots:[{id:'s',title:'读信',description:'窗边拿着信',narration:'雨后，信来了。',duration:5,characterIds:['c']}]};
    const image = dramaPrompt(plan,'image','s');
    expect(image).toContain('绘本插画风格');
    expect(image).toContain('单一连续构图');
    expect(image).toContain('小雨：短发，米色风衣');
    expect(image).not.toContain('绘本漫剧');
    expect(image).not.toContain(plan.shots[0].narration);
    expect(dramaPrompt(plan,'video','s')).toContain('连续的单镜头视频');
    expect(dramaPrompt(plan,'voice','s')).toBe(plan.shots[0].narration);
  });
});
