import { normalizeDramaPlan, readDramaOutput, selectedReferences, shotFingerprint, srtText, validateSelections } from './drama-plan';
import { emptyDramaPlan, DramaCandidate } from './drama.types';
import { publicMediaAddress } from './drama-render.service';
import { scriptToPlan } from '../../portal/src/utils/drama';

describe('Short drama product contracts', () => {
  const plan = () => ({ ...emptyDramaPlan(), title: '照片', story: '一个故事', characters: [{ id: 'girl', name: '小雨', description: '短发风衣' }], scenes: [{ id: 'cafe', name: '咖啡馆', description: '午后暖光' }],
    shots: [{ id: 'shot1', title: '相遇', description: '女孩推门', narration: '那天她走进咖啡馆。', duration: 5, characterIds: ['girl'], sceneId: 'cafe' }] });
  it('whitelists editable fields and rejects broken references, duplicate IDs and excess duration', () => {
    const normalized = normalizeDramaPlan({ ...plan(), ownerId: 'victim', url: 'https://evil.test' });
    expect(normalized).not.toHaveProperty('ownerId'); expect(normalized).not.toHaveProperty('url');
    expect(() => normalizeDramaPlan({ ...plan(), shots: [{ ...plan().shots[0], characterIds: ['missing'] }] })).toThrow('角色');
    expect(() => normalizeDramaPlan({ ...plan(), characters: [plan().characters[0], plan().characters[0]] })).toThrow('重复');
    expect(() => normalizeDramaPlan({ ...plan(), shots: Array.from({ length: 13 }, (_, i) => ({ ...plan().shots[0], id: `s${i}`, duration: 15 })) })).toThrow('180');
    expect(() => normalizeDramaPlan({ ...plan(), duration: NaN })).toThrow('数值');
  });
  it('only accepts successful candidates belonging to the corresponding target and media kind', () => {
    const p = { ...plan(), storyConfirmed: true, castConfirmed: true, storyboardConfirmed: true }; p.shots[0] = { ...p.shots[0], image: 'candidate1' } as any;
    const c = { id: 'candidate1', kind: 'image', targetId: 'shot1', status: 'succeeded', url: 'https://media.example/image.png' } as DramaCandidate;
    expect(selectedReferences(p)).toEqual([{ id: 'candidate1', kind: 'image', targetId: 'shot1' }]);
    expect(() => validateSelections(p, [c])).not.toThrow();
    for (const changed of [{ status: 'running' }, { targetId: 'shot2' }, { kind: 'video' }, { url: undefined }]) expect(() => validateSelections(p, [{ ...c, ...changed } as DramaCandidate])).toThrow('选用素材');
  });
  it('keeps stable fingerprints until production inputs change and generates cumulative SRT timing', () => {
    const p = plan(), before = shotFingerprint(p, 'shot1');
    p.shots[0].narration = '更新字幕'; expect(shotFingerprint(p, 'shot1')).toBe(before);
    p.characters[0].description = '长发'; expect(shotFingerprint(p, 'shot1')).not.toBe(before);
    p.shots.push({ ...p.shots[0], id: 'shot2', duration: 7 });
    expect(srtText(p)).toContain('00:00:05,000 --> 00:00:12,000');
  });
  it('reads genuine text/media outputs without interpreting task metadata as output', () => {
    expect(readDramaOutput({ taskId: 'foo', result: { output: ['https://media.example/clip.mp4'] } }, 'video')).toEqual({ url: 'https://media.example/clip.mp4' });
    expect(readDramaOutput({ videos: ['https://media.example/maas.mp4'] }, 'video')).toEqual({ url: 'https://media.example/maas.mp4' });
    expect(readDramaOutput({ choices: [{ message: { content: '{"title":"照片"}' } }] }, 'text')).toEqual({ text: '{"title":"照片"}' });
    const long = JSON.stringify({ story: '字'.repeat(17000) });
    expect(readDramaOutput({ choices: [{ message: { content: long } }, { message: { content: 'second' } }] }, 'text')).toEqual({ text: long });
    expect(readDramaOutput({ text: '字'.repeat(100001) }, 'text')).toEqual({ text: undefined });
    expect(readDramaOutput({ debug: { url: 'https://unrelated.example' } }, 'image')).toEqual({ url: undefined });
  });
  it('blocks private, loopback, link-local and IPv4-mapped render destinations', () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.2.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) expect(publicMediaAddress(ip)).toBe(false);
    expect(publicMediaAddress('8.8.8.8')).toBe(true); expect(publicMediaAddress('2606:4700:4700::1111')).toBe(true);
  });
  it('rejects unusable generated scripts before replacing a draft', () => {
    expect(() => scriptToPlan('{"title":"x"}', plan())).toThrow('剧本格式');
    const result = scriptToPlan('```json\n{"title":"相遇","characters":[{"name":"小雨","description":"短发"}],"scenes":[],"shots":[{"description":"推门","narration":"你好","characters":["小雨"],"duration":5}]}\n```', plan());
    expect(result.characters[0].id).not.toBe('girl'); expect(result.shots[0].characterIds).toEqual([result.characters[0].id]); expect(result.storyConfirmed).toBe(false);
  });
  it('rejects unknown cast, ambiguous names and invalid duration without modifying the original', () => {
    const original=plan(), before=JSON.stringify(original);
    const script={characters:[{name:'小雨',description:'短发'}],scenes:[],shots:[{description:'推门',characters:['陌生人'],duration:5}]};
    expect(()=>scriptToPlan(JSON.stringify(script),original)).toThrow('未定义的角色');
    expect(()=>scriptToPlan(JSON.stringify({...script,characters:[...script.characters,...script.characters]}),original)).toThrow('唯一');
    expect(()=>scriptToPlan(JSON.stringify({...script,shots:[{description:'推门',duration:99}]}),original)).toThrow('2–15');
    expect(JSON.stringify(original)).toBe(before);
  });
});
