import type { DramaPlan } from './drama.types';

export type ScriptAdoption = { mode: 'story'|'append'|'replace'; shots: string[] };
/** Appending never replaces existing roles, shot IDs or selected media. */
export function adoptScript(original: DramaPlan, incoming: DramaPlan, choice: ScriptAdoption): {plan:DramaPlan;impact:string[]} {
  if (choice.mode === 'story') return { plan: { ...original, title: incoming.title, story: incoming.story,
    storyConfirmed: false, castConfirmed: false, storyboardConfirmed: false, step: 0 },
    impact: ['只更新标题和故事文字；原角色、镜头、选片与配乐保留。', '故事修改后需要重新确认制作阶段。'] };
  if (choice.mode === 'replace') {
    const settings = { ...original.settings }; delete settings.music;
    return { plan: { ...incoming, production: original.production, frame: original.frame, guide: original.guide, settings,
      storyConfirmed: false, castConfirmed: false, storyboardConfirmed: false, step: 0 },
      impact: [`替换 ${original.shots.length} 个原镜头为 ${incoming.shots.length} 个新镜头，同时更新故事、角色和场景。`, '清除当前选片和配乐引用；已有候选与成片文件保留，可通过草稿历史恢复原计划。'] };
  }
  const selected = incoming.shots.filter(s => choice.shots.includes(s.id));
  if (!selected.length) throw new Error('请至少勾选一个要追加的镜头');
  if (original.shots.length + selected.length > 24) throw new Error('追加后超过 24 个镜头，请减少勾选范围');
  if ([...original.shots, ...selected].reduce((n,s) => n+s.duration,0) > 180) throw new Error('追加后超过 180 秒，请减少勾选范围');
  if (selected.some(s => original.shots.some(old => old.id === s.id))) throw new Error('镜头标识重复，请重新打开剧本预览');
  const characters = [...original.characters], scenes = [...original.scenes], reused = new Set<string>();
  const mapRole = (id: string, kind: 'character'|'scene') => {
    const source = (kind === 'character' ? incoming.characters : incoming.scenes).find(r => r.id === id);
    if (!source) throw new Error('所选镜头引用了不存在的角色或场景');
    const list = kind === 'character' ? characters : scenes;
    const existing = list.find(r => r.name === source.name);
    if (existing) { if (existing.description !== source.description) reused.add(source.name); return existing.id; }
    if (list.length >= 8) throw new Error('追加后角色或场景超过 8 个，请减少勾选范围');
    list.push({ id: source.id, name: source.name, description: source.description }); return source.id;
  };
  const appended = selected.map(s => ({ id: s.id, title: s.title, description: s.description, narration: s.narration, duration: s.duration,
    characterIds: s.characterIds.map(id => mapRole(id,'character')), sceneId: s.sceneId ? mapRole(s.sceneId,'scene') : undefined }));
  const addedRoles = characters.length + scenes.length - original.characters.length - original.scenes.length;
  return { plan: { ...original, characters, scenes, shots: [...original.shots,...appended],
    castConfirmed: addedRoles ? false : original.castConfirmed, storyboardConfirmed: false, step: addedRoles ? 1 : 2 },
    impact: [`追加 ${selected.length} 个勾选镜头；原 ${original.shots.length} 个镜头及选片、故事和配乐保留。`,
      `只补入关联的新角色或场景 ${addedRoles} 项，追加镜头尚无选片，不自动生成。`,
      ...(reused.size ? [`同名角色或场景沿用原设定：${[...reused].join('、')}，不会覆盖已有外貌或环境。`] : [])] };
}
