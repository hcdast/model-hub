import { emptyDramaPlan, type DramaPlan } from './drama.types';

/** Versioned text structures; never presented as already generated media. */
export const DRAMA_TEMPLATES = [
  { id: 'letter-story-v1', version: 1, name: '雨后的一封信', description: '单角色、两镜头的绘本叙事，适合先试做。',
    character: '小雨', appearance: '成年女性，短黑发，米色风衣，白衬衫',
    shots: ['雨后的咖啡馆里，小雨推门走向窗边。', '她发现桌上的信，露出微笑。'] },
  { id: 'small-courage-v1', version: 1, name: '勇气的一小步', description: '起因、行动、转折、结果，四镜头温暖旁白故事。',
    character: '小林', appearance: '成年男性，短黑发，蓝色夹克，帆布背包',
    shots: ['小林站在画室门前，手里握着自己的画稿。', '他深吸一口气，轻轻推开了门。', '老师翻开画稿，认真看着每一页。', '他接过报名表，紧张的脸上露出了笑容。'] },
];

export function templatePlan(id: string): DramaPlan | undefined {
  const t = DRAMA_TEMPLATES.find(t => t.id === id);
  if (!t) return undefined;
  return { ...emptyDramaPlan(), title: t.name, story: t.shots.join(''), duration: 30,
    production: { provider: 'akool-maas', models: {} }, frame: { ratio: '9:16', fit: 'contain', voiceVolume: 100 },
    characters: [{ id: 'lead', name: t.character, description: t.appearance }],
    shots: t.shots.map((description, i) => ({ id: `shot-${i + 1}`, title: `镜头 ${i + 1}`, description, narration: description, duration: 5, characterIds: ['lead'] })) };
}
