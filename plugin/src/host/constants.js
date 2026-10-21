export const PLUGIN_ID = 'dsh-medresearch-model';
export const PLUGIN_VERSION = '0.2.4';
export const ROUTE_PREFIX = '/api/medresearch/model';
export const SETTINGS_VERSION = 1;
export const DEFAULT_MODE = 'dsh';
export const MAX_BODY_BYTES = 1024 * 1024;
export const MAX_CHUNKS = 18;
export const MAX_CHUNK_CHARS = 2400;
export const MAX_QUESTION_CHARS = 8000;
export const REQUEST_TIMEOUT_MS = 65000;
export const CUSTOM_TEST_PROMPT = '这是连接测试。请只回复：连接测试通过。';
export const PROVIDERS = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    protocol: 'openai-chat-completions',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    protocol: 'openai-chat-completions',
  },
  custom: {
    id: 'custom',
    label: '自定义 OpenAI 兼容服务',
    baseURL: '',
    protocol: 'openai-chat-completions',
  },
};

