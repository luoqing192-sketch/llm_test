-- 删除知识库相关表
-- 注意：此操作会永久删除所有知识库和知识条目数据

DROP TABLE IF EXISTS document_chunks;
DROP TABLE IF EXISTS documents;
DROP TABLE IF EXISTS knowledge_items;
DROP TABLE IF EXISTS knowledge_bases;

-- 删除相关设置
DELETE FROM settings WHERE setting_key IN ('knowledge_retrieval_limit', 'knowledge_min_score');