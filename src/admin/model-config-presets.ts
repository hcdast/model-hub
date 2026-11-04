/** Disabled, deliberately unpriced presets. Operators configure verified prices before enabling. */
export function languageModelPreset() {
  return {
    model_id: 'DeepSeek-V4-Flash', provider_model_name: 'DeepSeek-V4-Flash', model_name: 'DeepSeek V4 Flash · 编剧',
    model_type: 'textGenerate', provider: 'akool-maas', disabled: true, contract_version: 2, sort: 100,
    description: 'MaaS LLM 编剧；请先配置供应商 LLM Base URL、账号池和真实价格。', tags: ['LLM', '短剧', '编剧'], unit_price_map: {},
    params: {
      maas_protocol: { type: 'string', required: true, default: 'chat-completions', enum: ['chat-completions'], hide: true },
      prompt: { type: 'string', required: true, maxLength: 20000, label: '创作要求', ui_type: 'textarea' },
      max_tokens: { type: 'integer', required: false, default: 4096, min: 256, max: 8192, label: '最大输出 Token' },
      temperature: { type: 'number', required: false, default: 0.7, min: 0, max: 2, label: '创意程度' },
    },
    pricing: { usage_type: 'token' as const, usage_param: 'max_tokens' },
    docs: { limitations: ['价格为每 Token 积分，须由管理员核实后填写。', '输出须预览并确认后才会应用到作品。'] },
  };
}

export function voiceModelPreset() {
  return {
    model_id: 'akool-voicelab-tts', provider_model_name: 'akool-openapi/voicelab-tts', model_name: 'AKOOL VoiceLab · 多语言配音',
    model_type: 'tts', provider: 'akool-openapi', disabled: true, contract_version: 2, sort: 100,
    description: 'VoiceLab 官方音色与多语言配音；在账号池配置 OpenAPI API Key，填写价格后启用。', tags: ['TTS', '短剧', '旁白'], unit_price_map: {},
    params: {
      text: { type: 'string', required: true, maxLength: 2000, label: '配音文本', ui_type: 'textarea' },
      voice_id: { type: 'string', required: true, maxLength: 500, label: '音色', description: '在短剧配音窗口选择并试听官方音色；选择值包含账号归属。' },
      voice_model_name: { type: 'string', required: true, default: 'Akool Multilingual 3', enum: ['Akool Multilingual 3'], hide: true },
      speed: { type: 'number', required: false, default: 1, min: 0.7, max: 1.2, label: '语速' },
      emotion: { type: 'string', required: false, default: 'neutral', enum: ['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised'], label: '情绪（中文）' },
      volume: { type: 'integer', required: false, default: 50, min: 0, max: 100, label: '生成音量' },
      language_code: { type: 'string', required: false, default: 'zh', enum: ['zh', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'it', 'pt', 'ar', 'hi'], label: '语言' },
    },
    pricing: { usage_type: 'count' as const, usage_param: 'text', usage_measure: 'characters' as const },
    docs: { limitations: ['价格为每字符积分；供应商每千字符报价需除以 1000 后填写，Portal 积分由管理员定价。', '当前使用官方 Akool Multilingual 3 音色；情绪参数仅适用于中文。', '生成结果需归档，供应商资源有有效期。'] },
  };
}
