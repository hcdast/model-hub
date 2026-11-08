import { randomUUID } from 'crypto';
import type { DramaPlan } from '../short-drama/drama.types';
import { dramaTemplateSnapshot } from './creation-template-snapshot';
import { normalizeDramaPlan } from '../short-drama/drama-plan';

/** Append portable content; remap every dependency and leave existing media selections intact. */
export function appendDramaStage(target: DramaPlan, source: DramaPlan, stage: 'characters' | 'storyboard') {
  const plan = structuredClone(target), portable = dramaTemplateSnapshot(source);
  const characters = new Map(portable.characters.map(c => [c.id, randomUUID()]));
  const scenes = new Map(portable.scenes.map(c => [c.id, randomUUID()]));
  plan.characters.push(...portable.characters.map(c => ({ ...c, id: characters.get(c.id)! })));
  if (stage === 'storyboard') {
    plan.scenes.push(...portable.scenes.map(c => ({ ...c, id: scenes.get(c.id)! })));
    plan.shots.push(...portable.shots.map(s => ({ ...s, id: randomUUID(), characterIds: s.characterIds.map(id => characters.get(id)!), ...(s.sceneId ? { sceneId: scenes.get(s.sceneId) } : {}) })));
  }
  plan.castConfirmed = false; plan.storyboardConfirmed = false;
  return normalizeDramaPlan(plan);
}
