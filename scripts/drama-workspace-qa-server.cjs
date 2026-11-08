// Isolated UI scenarios. No database, upstream calls, credentials or production cookies.
const express = require('express');
const path = require('node:path');
const { renderManifest } = require('../dist/short-drama/drama-version');
const scenarios = ['normal','save-error','conflict','partial','version-current','version-changed','version-legacy'];
const app = express(), host = '127.0.0.2', port = 7337;
const id = 'workspace-qa', origin = `http://${host}:${port}`;
const clone = value => JSON.parse(JSON.stringify(value));
let mode = 'normal', failed = false, project;
function reset() {
  failed = false;
  project = { id, revision: 1, candidates: ['old','new'].map((name,i)=>({id:name,projectId:id,kind:'image',targetId:'s1',status:'succeeded',source:'upload',url:`${origin}/media/${name}.svg`,archiveStatus:'archived',createdAt:`2026-11-06T00:0${i}:00Z`})),
    budget:{limit:10,used:0,reserved:0,remaining:10},history:[],pendingRequests:[],
    plan:{title:'隔离交互验收（非真实作品）',story:'女孩推门。',inputMode:'idea',style:'绘本漫剧',duration:10,step:2,storyConfirmed:true,castConfirmed:true,storyboardConfirmed:true,
      characters:[{id:'c',name:'小雨',description:'米色风衣'}],scenes:[],shots:[{id:'s1',title:'已有画面',description:'女孩推门',narration:'你好',duration:5,characterIds:['c'],image:'old'},{id:'s2',title:'需要补齐',description:'女孩走进房间',narration:'早上好',duration:5,characterIds:['c']}],
      production:{provider:'akool-maas',models:{}},settings:{subtitles:true,subtitleStyle:'white',musicVolume:18,resolution:'720p'},frame:{ratio:'9:16',fit:'contain',voiceVolume:100}}};
  if(mode==='partial') project.candidates.push({id:'failed',projectId:id,kind:'image',targetId:'s2',source:'model',status:'failed',error:'隔离场景：供应商临时失败，未扣费'});
  if(mode.startsWith('version-')) {
    project.plan.step=4;
    project.plan.shots.forEach(s=>{s.video='video-'+s.id;s.image='image-'+s.id;s.narration='';project.candidates.push({id:s.video,projectId:id,kind:'video',targetId:s.id,status:'succeeded',source:'upload',url:origin+'/media/fixture.mp4',archiveStatus:'archived'},{id:s.image,projectId:id,kind:'image',targetId:s.id,status:'succeeded',source:'upload',url:origin+'/media/old.svg',archiveStatus:'archived'});});
    const record={id:'film',projectId:id,kind:'export',targetId:'project',status:'succeeded',source:'render',url:origin+'/media/fixture.mp4'};
    if(mode!=='version-legacy')record.renderSource={revision:1,manifest:renderManifest(project.plan)};
    project.candidates.push(record);if(mode==='version-changed')project.plan.frame.fit='cover';
  }
}
reset();app.use(express.json());
app.get('/__qa',(_q,r)=>r.type('html').send('<h1>隔离短剧界面回归</h1><p>不连接真实数据库，不发起生成，不读取生产凭证。</p>'+scenarios.map(s=>`<p><a href="/__qa/setup?scenario=${s}">${s}</a></p>`).join('')));
app.get('/__qa/setup',(q,r)=>{mode=scenarios.includes(q.query.scenario)?q.query.scenario:'normal';reset();r.cookie('portal_csrf_token','isolated-qa-only',{sameSite:'lax',maxAge:3600000});r.redirect(`/short-dramas/${id}`);});
app.get('/media/fixture.mp4',(_q,r)=>r.sendFile(path.resolve(__dirname,'../output/verification/workspace-qa.mp4')));
app.get('/media/:name',(q,r)=>r.type('svg').send(`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280"><rect width="720" height="1280" fill="${q.params.name==='old.svg'?'#273854':'#70583d'}"/><circle cx="360" cy="450" r="150" fill="#cbb7ef"/><text x="360" y="850" text-anchor="middle" fill="white" font-size="60">${q.params.name==='old.svg'?'CURRENT':'CANDIDATE'}</text></svg>`));
app.use('/api/v1',(q,r)=>{
  const url=q.path,method=q.method;let data;
  if(url==='/auth/refresh') data={accessToken:'isolated-not-a-real-token'};
  else if(url==='/auth/me') data={id:'isolated-workspace-owner',username:'隔离验收',role:'user',status:'active',usage:{totalWorkflows:0,totalRuns:0,totalTokens:0}};
  else if(url==='/short-dramas/models') data=[];
  else if(url==='/short-dramas/capabilities') data={mp4:true,subtitles:true,generationEnabled:false,createEnabled:false,exportEnabled:false};
  else if(url===`/short-dramas/${id}` && method==='PUT') {
    if(mode==='conflict')return r.status(409).json({code:'DRAMA_REVISION_CONFLICT',message:'隔离场景：作品已在其他窗口更新'});
    if(mode==='save-error'&&!failed){failed=true;return r.status(503).json({message:'隔离场景：暂时无法保存，编辑仍保留'});}
    if(q.body.revision!==project.revision)return r.status(409).json({message:'隔离场景：版本冲突'});
    project.plan=clone(q.body.plan);project.revision++;data=project;
  }
  else if(url===`/short-dramas/${id}`)data=project;
  else if(url==='/short-dramas')data={items:[project],total:1,pageSize:24};
  else if(url==='/notifications/unread-count')data={count:0};
  else if(method!=='GET')return r.status(400).json({message:'隔离回归不允许生成、扣费或调用真实服务'});
  else data={items:[],total:0};
  r.json({code:0,message:'isolated fixture',data});
});
app.use(express.static(path.resolve(__dirname,'../portal/dist')));
app.get('*',(_q,r)=>r.sendFile(path.resolve(__dirname,'../portal/dist/index.html')));
const server=app.listen(port,host,()=>process.stdout.write(`Isolated workspace QA: ${origin}/__qa\n`));
process.on('SIGINT',()=>server.close());
