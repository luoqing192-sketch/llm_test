import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

// 延迟初始化：不在模块加载时创建客户端，避免环境变量缺失报错
let _client = null;

function getClient(apiKey, baseURL) {
  // 每次检查 key 是否变了（管理后台可能更新）
  const key = apiKey || process.env.LLM_API_KEY;
  const url = baseURL || process.env.LLM_BASE_URL || 'https://api.openai.com/v1';

  if (!_client || _client._config_key !== key || _client._config_url !== url) {
    if (!key) {
      throw new Error(
        'Embedding API Key 未配置。请在管理后台 → LLM 配置中设置 API Key，' +
        '或在 .env 文件中设置 LLM_API_KEY'
      );
    }
    _client = new OpenAI({ apiKey: key, baseURL: url });
    _client._config_key = key;
    _client._config_url = url;
  }
  return _client;
}

export async function getEmbedding(text, apiKey, baseURL) {
  const client = getClient(apiKey, baseURL);
  const model = process.env.EMBEDDING_MODEL || 'text-embedding-ada-002';

  const response = await client.embeddings.create({
    model,
    input: text,
  });
  return response.data[0].embedding;
}

export async function getEmbeddings(texts, apiKey, baseURL) {
  const client = getClient(apiKey, baseURL);
  const model = process.env.EMBEDDING_MODEL || 'text-embedding-ada-002';

  const response = await client.embeddings.create({
    model,
    input: texts,
  });
  return response.data.map(item => item.embedding);
}
