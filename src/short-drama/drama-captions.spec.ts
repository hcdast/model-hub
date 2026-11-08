import { captionSentences, estimateCaptions, parseSpeechWindows } from './drama-captions';
import { normalizeDramaPlan, validateCaptionSources } from './drama-plan';
import { emptyDramaPlan, DramaShot } from './drama.types';
import { dramaSrt } from './drama-timing';
const shot=():DramaShot=>({id:'s',title:'来信',description:'',narration:'你好。明天见！',duration:5,characterIds:[],voice:'voice'});
describe('Split caption timeline',()=>{
  it('splits long multilingual text without losing punctuation or Unicode characters',()=>{
    const text='你好，今天的天空很蓝。'+ '一'.repeat(55)+'🙂！';const parts=captionSentences(text);
    expect(parts.join('')).toBe(text);expect(parts.every(p=>Array.from(p).length<=22)).toBe(true);
  });
  it('excludes real leading/trailing silence and maps sentence boundaries across pauses',()=>{
    const windows=parseSpeechWindows('silence_start: 0\nsilence_end: 1\nsilence_start: 2\nsilence_end: 3\nsilence_start: 4',5);
    expect(windows).toEqual([{start:1,end:2},{start:3,end:4}]);
    const cues=estimateCaptions({...shot(),narration:'你好。再见。'},{shotId:'s',seconds:5,windows});
    expect(cues).toEqual([{start:1,end:2,text:'你好。'},{start:3,end:4,text:'再见。'}]);
    expect(parseSpeechWindows('',5)).toEqual([{start:0,end:5}]);
    expect(()=>estimateCaptions(shot(),{shotId:'s',seconds:5,windows:[]})).toThrow('语音');
  });
  it('round-trips manual cues and exports the same fractional global timeline',()=>{
    const s={...shot(),captions:[{start:.25,end:1.5,text:'你好。'},{start:2,end:4.25,text:'明天见！'}],captionSource:{narration:shot().narration,voiceId:'voice',method:'manual' as const}};
    const p=normalizeDramaPlan({...emptyDramaPlan(),shots:[{...shot(),id:'silent',voice:undefined,narration:'',duration:3},s]});
    expect(dramaSrt(p)).toBe('1\n00:00:03,250 --> 00:00:04,500\n你好。\n\n2\n00:00:05,000 --> 00:00:07,250\n明天见！\n');
    expect(()=>validateCaptionSources(p)).not.toThrow();
    expect(()=>validateCaptionSources({...p,shots:[{...s,voice:'new-voice'}]})).toThrow('旁白');
    expect(()=>validateCaptionSources({...p,shots:[{...s,narration:'另一个故事'}]})).toThrow('旁白');
  });
  it('rejects overlapping, reversed, out-of-shot and nonfinite cues at persistence',()=>{
    for(const cues of [[{start:0,end:4,text:'a'},{start:3,end:5,text:'b'}],[{start:2,end:1,text:'a'}],[{start:0,end:6,text:'a'}],[{start:NaN,end:3,text:'a'}]]) {
      expect(()=>normalizeDramaPlan({...emptyDramaPlan(),shots:[{...shot(),captions:cues}]})).toThrow('字幕时间');
    }
  });
  it('bounds dense captions and keeps manual silence distinct from the legacy fallback',()=>{
    const s={...shot(),duration:2,narration:'一。'.repeat(1000)};const cues=estimateCaptions(s);
    expect(cues.length).toBeLessThanOrEqual(25);expect(cues.map(c=>c.text).join('')).toBe(s.narration);
    expect(dramaSrt({...emptyDramaPlan(),shots:[{...shot(),captions:[]}]})).toBe('');
  });
});
