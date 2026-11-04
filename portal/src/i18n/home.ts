import type { Locale } from './messages';

interface HomeCopy {
  eyebrow: string; title: [string, string]; intro: string; create: string; explore: string; access: string;
  preview: string; visualNote: string; input: string; generate: string; output: string;
  metrics: [string, string, string]; scenesTitle: string; scenesIntro: string;
  categories: [string, string, string, string, string]; discover: string;
  scenes: Array<{ title: string; description: string; steps: string }>;
  modelsTitle: string; modelsIntro: string; allModels: string; modelDoc: string;
  catalogError: string; catalogEmpty: string; retry: string;
  resourcesTitle: string; resourcesIntro: string; readGuide: string; guideLabel: string;
  guides: Array<{ title: string; description: string; duration: string; steps: Array<[string, string]> }>;
  recent: string; allWorkflows: string; emptyWorkflows: string; workflowError: string; nodes: string;
  closingTitle: string; closingBody: string; docs: string; footer: string; noDescription: string;
}

export const homeCopy: Record<Locale, HomeCopy> = {
  zh: {
    eyebrow: '灵感，在这里连接', title: ['从一个想法，', '到无限种可能。'],
    intro: '探索图像、视频、语音与文本模型，在可视化画布上连接创作流程，让灵感一步步成为作品。',
    create: '开始创作', explore: '探索模型', access: '自由浏览模型与文档，开始创作时再登录。',
    preview: '把灵感变成画面', visualNote: '原创场景插画 · 非模型生成结果', input: '输入灵感', generate: '连接模型', output: '创作输出',
    metrics: ['可用模型配置', '创作能力类型', '模型服务商'], scenesTitle: '下一件作品，从这里开始',
    scenesIntro: '从不同创作场景出发，找到适合你的模型。', categories: ['全部', '图像', '视频', '音频', '文本'], discover: '探索相关模型',
    scenes: [
      { title: '让品牌有自己的视觉语言', description: '从商品概念到风格画面，用文字探索新的视觉表达。', steps: '创意描述 → 图像生成' },
      { title: '让想象动起来', description: '为故事、短片与创意内容，探索从文字到动态画面的可能。', steps: '分镜灵感 → 视频生成' },
      { title: '为内容找到合适的声音', description: '将文字转为语音，为解说、故事和多语言内容增添表达。', steps: '文案输入 → 语音合成' },
      { title: '从零散想法到清晰表达', description: '借助文本模型整理思路，探索文案、摘要与故事创作。', steps: '想法输入 → 文本生成' },
    ],
    modelsTitle: '发现适合你的模型', modelsIntro: '来自当前模型目录，覆盖不同创作能力。', allModels: '查看全部模型', modelDoc: '查看文档',
    catalogError: '模型目录暂时无法加载，请稍后重试。', catalogEmpty: '暂时没有可展示的模型。', retry: '重新加载',
    resourcesTitle: '给灵感一点方法', resourcesIntro: '从第一步开始，了解模型选择、工作流搭建与接入方式。', readGuide: '阅读指南', guideLabel: '入门指南',
    guides: [
      { title: '搭建你的第一个工作流', description: '在画布上把输入、模型和输出连接起来。', duration: '3 分钟阅读', steps: [
        ['从创作目标开始', '先明确想生成图像、视频、语音还是文本，再去模型目录了解适合的模型。'],
        ['创建并连接节点', '登录后新建工作流，在画布中添加输入、模型和输出节点，连接兼容的端口。也可以从模型详情页开始使用。'],
        ['检查参数与运行结果', '按模型文档补齐必填参数，保存工作流后执行，并在运行记录中查看各节点的状态与输出。'],
      ] },
      { title: '把想法写成更清晰的提示词', description: '从主体、场景到风格，建立自己的表达方式。', duration: '2 分钟阅读', steps: [
        ['描述你想看到的内容', '写清主体、动作、环境与构图。例如：一只磨砂玻璃香水瓶，置于浅绿色展台，柔和侧光。'],
        ['补充风格与限制', '加入色调、镜头或语气要求。参数范围、输入格式与可用能力以对应模型文档为准。'],
        ['一次调整一个变量', '保留原始提示词，逐步调整风格或参数，对照输出，积累适合自己场景的表达。'],
      ] },
      { title: '从模型文档开始接入', description: '找到参数说明、请求示例与在线调试入口。', duration: '3 分钟阅读', steps: [
        ['确认模型与服务商', '在模型目录中按能力和服务商筛选。同名模型可能有多个配置，请选择符合需求的具体配置。'],
        ['阅读参数与请求示例', '打开模型文档，确认必填项、媒体输入类型和返回结构，参考该模型的 API 示例进行接入。'],
        ['验证后再编排', '需要在线调试或创建工作流时登录，先验证单个模型的输入输出，再连接完整流程。'],
      ] },
    ],
    recent: '继续上次的创作', allWorkflows: '全部工作流', emptyWorkflows: '你的第一条工作流，从一个想法开始。', workflowError: '最近工作流加载失败。', nodes: '个节点',
    closingTitle: '下一个好作品，始于你的想法。', closingBody: '选一个模型，连接一段流程，开始探索。', docs: '浏览模型文档', footer: '连接模型，释放创作灵感。', noDescription: '查看模型文档，了解能力、参数与接入方式。',
  },
  en: {
    eyebrow: 'WHERE IDEAS CONNECT', title: ['One idea.', 'Endless possibilities.'],
    intro: 'Explore image, video, voice and text models. Connect them on a visual canvas and bring your next idea to life, step by step.',
    create: 'Start creating', explore: 'Explore models', access: 'Browse models and docs freely. Sign in when you are ready to create.',
    preview: 'Give your ideas a new form', visualNote: 'Original concept illustration · Not a model output', input: 'Your idea', generate: 'Connect models', output: 'Creative output',
    metrics: ['Model configurations', 'Capability types', 'Model providers'], scenesTitle: 'What will you create next?',
    scenesIntro: 'Start with a creative direction and find the models to match.', categories: ['All', 'Image', 'Video', 'Audio', 'Text'], discover: 'Explore models',
    scenes: [
      { title: 'Find your visual language', description: 'Explore product concepts and distinctive visuals, starting with a few words.', steps: 'Creative brief → Image generation' },
      { title: 'Set your imagination in motion', description: 'Explore moving worlds for stories, short films and creative content.', steps: 'Story idea → Video generation' },
      { title: 'Give your content a voice', description: 'Turn text into speech for narration, storytelling and multilingual content.', steps: 'Written script → Speech synthesis' },
      { title: 'Turn thoughts into a story', description: 'Organize ideas and explore copy, summaries and stories with text models.', steps: 'Your ideas → Text generation' },
    ],
    modelsTitle: 'Find your next creative model', modelsIntro: 'Explore different capabilities from the live model catalog.', allModels: 'View all models', modelDoc: 'Read documentation',
    catalogError: 'The model catalog could not be loaded. Please try again.', catalogEmpty: 'No models are available yet.', retry: 'Try again',
    resourcesTitle: 'A little guidance goes a long way', resourcesIntro: 'Get started with model selection, visual workflows and integration.', readGuide: 'Read guide', guideLabel: 'Getting started',
    guides: [
      { title: 'Build your first workflow', description: 'Connect inputs, models and outputs on the canvas.', duration: '3 min read', steps: [
        ['Start with an outcome', 'Decide whether you want an image, video, voice or text output. Explore the model catalog to find a suitable model.'],
        ['Add and connect nodes', 'Sign in and create a workflow. Add input, model and output nodes to the canvas and connect compatible ports. You can also start from a model detail page.'],
        ['Check parameters and results', 'Complete required parameters using the model documentation. Save and run your workflow, then review node states and outputs in run history.'],
      ] },
      { title: 'Write a clearer creative prompt', description: 'Build your expression through subject, setting and style.', duration: '2 min read', steps: [
        ['Describe what you want', 'Specify the subject, action, environment and composition. For example: a frosted glass perfume bottle on a pale green pedestal, with soft side lighting.'],
        ['Add style and constraints', 'Include your palette, camera direction or tone. Check the model documentation for supported parameters, formats and capabilities.'],
        ['Change one thing at a time', 'Keep the original prompt and adjust a style choice or parameter. Compare outputs to develop a useful approach for your creative task.'],
      ] },
      { title: 'Start integrating with model docs', description: 'Find parameters, request examples and the playground.', duration: '3 min read', steps: [
        ['Choose a model and provider', 'Filter the catalog by capability and provider. Models with the same name can have multiple configurations, so choose the specific one you need.'],
        ['Read parameters and examples', 'Open the model documentation to check required fields, media inputs and response structures. Use the API example for that model.'],
        ['Validate before connecting', 'Sign in to use the playground or create workflows. Verify one model’s inputs and outputs before connecting a complete flow.'],
      ] },
    ],
    recent: 'Pick up where you left off', allWorkflows: 'All workflows', emptyWorkflows: 'Your first workflow starts with an idea.', workflowError: 'Recent workflows could not be loaded.', nodes: 'nodes',
    closingTitle: 'Your next creation starts with an idea.', closingBody: 'Choose a model. Connect a workflow. See where it takes you.', docs: 'Browse model docs', footer: 'Connect models. Make room for ideas.', noDescription: 'Read the documentation for capabilities, parameters and integration.',
  },
  ja: {
    eyebrow: 'アイデアがつながる場所', title: ['ひとつのアイデアから、', '無限の可能性へ。'],
    intro: '画像・動画・音声・テキストのモデルを探索。ビジュアルキャンバスでつなぎ、アイデアを一歩ずつ作品にしましょう。',
    create: '制作を始める', explore: 'モデルを探す', access: 'モデルとドキュメントは自由に閲覧できます。制作を始めるときにログインしてください。',
    preview: 'アイデアをかたちに', visualNote: 'オリジナルのイメージ図・モデルの生成結果ではありません', input: 'アイデア', generate: 'モデルを接続', output: '作品を出力',
    metrics: ['モデル設定', '機能の種類', 'プロバイダー'], scenesTitle: '次は、何をつくりますか？',
    scenesIntro: '制作シーンから、ぴったりのモデルを見つけましょう。', categories: ['すべて', '画像', '動画', '音声', 'テキスト'], discover: '関連モデルを探す',
    scenes: [
      { title: 'ブランドらしいビジュアルへ', description: '商品のコンセプトから印象的な画像まで、言葉で新しい表現を探します。', steps: 'コンセプト → 画像生成' },
      { title: '想像の世界に動きを', description: '物語や短編映像、クリエイティブなコンテンツを動画で表現します。', steps: 'ストーリー → 動画生成' },
      { title: 'コンテンツに声を届ける', description: '文章を音声に変換し、ナレーションや多言語コンテンツに活用します。', steps: '原稿 → 音声合成' },
      { title: 'アイデアを伝わる文章に', description: 'テキストモデルで考えを整理し、コピーや要約、物語づくりを進めます。', steps: 'アイデア → テキスト生成' },
    ],
    modelsTitle: '制作に合うモデルを発見', modelsIntro: '現在のモデルカタログから、さまざまな機能を紹介します。', allModels: 'すべてのモデル', modelDoc: 'ドキュメントを読む',
    catalogError: 'モデルを読み込めませんでした。再試行してください。', catalogEmpty: '表示できるモデルはまだありません。', retry: '再読み込み',
    resourcesTitle: 'アイデアを進めるヒント', resourcesIntro: 'モデル選びからワークフローの構築、API 連携まで。', readGuide: 'ガイドを読む', guideLabel: '入門ガイド',
    guides: [
      { title: '最初のワークフローをつくる', description: 'キャンバス上で入力、モデル、出力をつなぎます。', duration: '約3分', steps: [
        ['目的を決める', '画像、動画、音声、テキストのどれを生成するか決め、モデルカタログから適したモデルを探します。'],
        ['ノードを追加して接続する', 'ログイン後にワークフローを新規作成し、入力・モデル・出力ノードの互換性のあるポートを接続します。モデル詳細からも開始できます。'],
        ['パラメータと結果を確認する', 'モデル文書を参考に必須項目を設定し、保存して実行します。実行履歴で各ノードの状態と出力を確認します。'],
      ] },
      { title: '伝わるプロンプトを書く', description: '被写体、シーン、スタイルでイメージを明確に。', duration: '約2分', steps: [
        ['欲しい内容を具体的に', '被写体、動作、環境、構図を書きます。例：淡い緑の台に置かれたすりガラスの香水瓶、柔らかなサイドライト。'],
        ['スタイルと条件を加える', '色調、カメラ、語調などを加えます。対応するパラメータや入力形式は、モデルのドキュメントで確認してください。'],
        ['ひとつずつ調整する', '元のプロンプトを残し、スタイルやパラメータをひとつずつ変更して出力を比較します。'],
      ] },
      { title: 'ドキュメントから API 連携へ', description: 'パラメータ、リクエスト例、テスト機能を確認。', duration: '約3分', steps: [
        ['モデルとプロバイダーを選ぶ', '機能とプロバイダーで絞り込みます。同名のモデルに複数の設定がある場合は、必要な設定を選んでください。'],
        ['パラメータと例を読む', '必須項目、メディア入力、レスポンス形式を確認し、そのモデルの API 例を参考に連携します。'],
        ['検証してから接続する', 'オンラインテストやワークフロー作成時にログインし、まず単一モデルの入出力を確認してから全体をつなぎます。'],
      ] },
    ],
    recent: '前回の制作を続ける', allWorkflows: 'ワークフロー一覧', emptyWorkflows: '最初のワークフローは、ひとつのアイデアから。', workflowError: '最近のワークフローを読み込めませんでした。', nodes: 'ノード',
    closingTitle: '次の作品は、あなたのアイデアから。', closingBody: 'モデルを選び、フローをつなぎ、新しい表現を探しましょう。', docs: 'モデル文書を見る', footer: 'モデルをつなぎ、創造を広げる。', noDescription: '機能、パラメータ、連携方法はドキュメントをご覧ください。',
  },
};
