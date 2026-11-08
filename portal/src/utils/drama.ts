import { emptyDramaPlan, type DramaPlan, type DramaCandidate, type DramaKind } from '../../../src/short-drama/drama.types';
export { emptyDramaPlan, DRAMA_STEPS, DRAMA_STYLES } from '../../../src/short-drama/drama.types';
export const dramaId = () => crypto.randomUUID();
export const exampleDescriptions = ['小雨在窗边坐下，服务员递来一封没有署名的信。', '信封里是一张旧照片，照片上的女孩正是她自己。', '她翻过照片，背面的日期竟然是明天。', '窗外，一个熟悉的身影停在街角。', '陈先生走近，像是等了这场相遇很久。', '他放下第二杯咖啡，轻轻推到她面前。', '陈先生取出一封泛黄的信，递给小雨。', '照片背面的字迹，与信上的字迹完全相同。', '雨渐渐停了，阳光照进安静的咖啡馆。', '小雨收好照片，推开咖啡馆的门。', '街角的人转过身，露出久违的笑容。', '她终于明白，有些相遇从来没有迟到。'];
export const exampleTitles = ['意外的信封', '照片中的自己', '明天的日期', '窗外的身影', '熟悉的来客', '桌上的第二杯咖啡', '一封未寄出的信', '照片上的约定', '雨停的街角', '走出咖啡馆', '迟到十年的相遇', '故事才刚刚开始'];
export function exampleDrama(): DramaPlan {
  const p = emptyDramaPlan(), girl = dramaId(), man = dramaId(), cafe = dramaId(), street = dramaId();
  return { ...p, title: '来自明天的照片', story: '一位女孩在咖啡馆收到一封没有署名的信。信里是一张旧照片，照片背后的日期竟然是明天。她循着照片找到一位等候多年的陌生人，揭开一场迟到十年的约定。',
    characters: [{ id: girl, name: '小雨', description: '24 岁，齐耳短发，米色风衣，浅色内搭。气质安静，眼神有好奇和坚定。' }, { id: man, name: '陈先生', description: '46 岁，短发微灰，深绿色外套，浅色衬衫。温和而寡言。' }],
    scenes: [{ id: cafe, name: '街角咖啡馆', description: '木质家具，午后暖光透过窗户，安静而温暖。' }, { id: street, name: '雨后的街道', description: '雨后街角，湿润的石板路，柔和阳光。' }],
    shots: exampleDescriptions.map((description, i) => ({ id: dramaId(), title: exampleTitles[i], description, narration: description, duration: 5, characterIds: i > 3 && i < 9 ? [girl, man] : [girl], sceneId: i === 3 || i === 9 || i === 10 ? street : cafe })) };
}
export function candidateFor(candidates: DramaCandidate[], id?: string) { return candidates.find(c => c.id === id && c.status === 'succeeded'); }
export function targetCandidates(candidates: DramaCandidate[], kind: DramaKind, targetId: string) { return candidates.filter(c => c.kind === kind && c.targetId === targetId); }
/** Import generated structure into a draft; confirmation and selected assets must be explicit. */
export function scriptToPlan(text: string, original: DramaPlan): DramaPlan {
  let data: any;
  try { data = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { throw new Error('剧本不是有效 JSON，请检查引号、逗号与括号。'); }
  if (!data || !Array.isArray(data.characters) || !Array.isArray(data.scenes) || !Array.isArray(data.shots) || !data.shots.length || data.shots.length > 24 || data.characters.length > 8 || data.scenes.length > 8) throw new Error('剧本格式不完整：需要 characters、scenes、shots 数组，1–24 个镜头，角色与场景各最多 8 个。');
  const string = (v: unknown, max: number, label: string, fallback = '') => {
    if (v === undefined) return fallback;
    if (typeof v !== 'string' || v.length > max) throw new Error(label + '必须是文字且不超过 ' + max + ' 字');
    return v.trim();
  };
  const roles = (list: any[], label: string) => {
    const names = new Set<string>();
    return list.map((x,i) => {
      if (!x || typeof x !== 'object') throw new Error(label + (i+1) + '格式不正确');
      const name = string(x.name,60,label+'名称'), description = string(x.description,2000,label+'描述');
      if (!name || !description || names.has(name)) throw new Error(label + (i+1) + '需要唯一名称与描述');
      names.add(name); return {id:dramaId(),name,description};
    });
  };
  const characters = roles(data.characters,'角色'), scenes = roles(data.scenes,'场景');
  const shots = data.shots.map((s: any, i: number) => {
    if (!s || typeof s !== 'object') throw new Error('镜头 '+(i+1)+'格式不正确');
    const description = string(s.description,3000,'画面描述');
    if (!description) throw new Error('镜头 '+(i+1)+'缺少画面描述');
    const duration = s.duration === undefined ? 5 : Number(s.duration);
    if (!Number.isInteger(duration) || duration < 2 || duration > 15) throw new Error('镜头 '+(i+1)+'时长需要为 2–15 秒整数');
    if (s.characters !== undefined && (!Array.isArray(s.characters) || s.characters.some((name: unknown) => !characters.some(c => c.name === name)))) throw new Error('镜头 '+(i+1)+'引用了未定义的角色');
    if (s.scene !== undefined && s.scene !== '' && !scenes.some(c => c.name === s.scene)) throw new Error('镜头 '+(i+1)+'引用了未定义的场景');
    return { id:dramaId(),title:string(s.title,100,'镜头标题','镜头 '+(i+1)),description,narration:string(s.narration,2000,'旁白'),duration,characterIds:characters.filter(c => s.characters?.includes(c.name)).map(c=>c.id),sceneId:scenes.find(c=>c.name === s.scene)?.id };
  });
  if (shots.reduce((sum: number,s: {duration:number})=>sum+s.duration,0)>180) throw new Error('生成剧本超过 180 秒，请减少镜头或调整时长。');
  const settings = { ...original.settings }; delete settings.music;
  return { ...original,title:string(data.title,100,'标题',original.title),story:string(data.story,12000,'故事',original.story),characters,scenes,shots,settings,
    storyConfirmed:false,castConfirmed:false,storyboardConfirmed:false,step:0 };
}

export { dramaSrt as planSrt } from '../../../src/short-drama/drama-timing';

export function downloadText(text: string, name: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
