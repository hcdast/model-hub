/**
 * 从 seed/model-configs.json 生成 output/task-demo-appendix.generated.md
 */
const fs = require('fs');
const path = require('path');

function lastSeg(name) {
  const p = String(name).split('/');
  return p[p.length - 1] || name;
}

function inferScene(name) {
  const l = lastSeg(name);
  const map = {
    'text-to-image': '文生图',
    edit: '编辑',
    'image-to-image': '图生图',
    'image-to-video': '图生视频',
    'text-to-video': '文生视频',
    'reference-to-video': '参考生视频',
    'video-to-video': '视频生视频',
    'video-edit': '视频编辑',
    animate: '角色动画',
    'motion-control': '动作控制',
    characterswap: '角色换装',
    'character-swap': '角色换装',
    headswap: '换头',
    'head-swap': '换头',
    tts: 'TTS',
    'music-2.5+': '音乐生成',
  };
  if (map[l]) return map[l];
  if (l.includes('tts')) return 'TTS';
  if (l.startsWith('gemini')) return '文本生成 (Gemini)';
  if (/^Akool|^wan|^MiniMax|^doubao|^seedance/i.test(String(name))) {
    return '内部/聚合模型名（见 AGI Job）';
  }
  return l;
}

/**
 * @param {string} [seedPath]
 * @param {string} [outPath]
 */
function generateTaskDemoAppendix(
  seedPath = path.join(__dirname, '../../seed/model-configs.json'),
  outPath = path.join(__dirname, '../../output/task-demo-appendix.generated.md'),
) {
  const seed = path.resolve(seedPath);
  const out = path.resolve(outPath);
  if (!fs.existsSync(seed)) {
    throw new Error(`缺少 seed 文件: ${seed}`);
  }
  const models = JSON.parse(fs.readFileSync(seed, 'utf8'));

  const byProvider = {};
  for (const m of models) {
    const key = m.provider || '(empty)';
    if (!byProvider[key]) byProvider[key] = [];
    byProvider[key].push(m);
  }

  const order = Object.keys(byProvider).sort((a, b) => {
    if (a === '(empty)') return 1;
    if (b === '(empty)') return -1;
    return byProvider[b].length - byProvider[a].length;
  });

  const lines = [];
  lines.push('<!-- 由 seed:models:collect --appendix 根据 seed/model-configs.json 生成，勿手改 -->');
  lines.push('');
  lines.push(
    `> 全量 **${models.length}** 条模型配置。列表主键为 \`model_id\`（与创建任务请求一致）。`,
  );
  lines.push('');

  for (const prov of order) {
    const list = byProvider[prov];
    lines.push(`### provider: \`${prov}\`（${list.length} 个）`);
    lines.push('');
    lines.push('| # | model_id | 场景说明 | model_type |');
    lines.push('|---|----------|----------|------------|');
    list
      .sort((a, b) => String(a.model_id).localeCompare(String(b.model_id)))
      .forEach((m, i) => {
        const mid = m.model_id || m.provider_model_name || '';
        const scene = inferScene(mid);
        const safe = String(mid).replace(/\|/g, '\\|');
        lines.push(`| ${i + 1} | \`${safe}\` | ${scene} | ${m.model_type} |`);
      });
    lines.push('');
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join('\n'), 'utf8');
  return { count: models.length, out, lines: lines.length };
}

module.exports = { generateTaskDemoAppendix };
