/**
 * code-generator.js
 * 代码生成工具模块 - 提供6个 OpenAI function calling 兼容的工具定义和执行函数
 * 用于在隔离的 demo_code/{conversationId} 目录中进行代码搜索、读取、生成等操作
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ============================================================
// Tool Schema 定义 (OpenAI function calling 格式)
// ============================================================

export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "search_codebase",
      description: "搜索当前项目代码库中的相关代码片段，用于发现相关类、接口、依赖",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词" },
          file_pattern: { type: "string", description: "文件匹配模式，如 *.tsx, *.js" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取指定文件的内容，支持按行范围读取",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径（相对于项目根目录）" },
          start_line: { type: "integer", description: "起始行号（1-based）" },
          end_line: { type: "integer", description: "结束行号（1-based，包含）" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_project_structure",
      description: "获取项目目录结构，以树形格式展示",
      parameters: {
        type: "object",
        properties: {
          depth: { type: "integer", description: "目录遍历深度，默认为3" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_symbol_definition",
      description: "查找代码中的符号定义，如函数、类、接口、类型等",
      parameters: {
        type: "object",
        properties: {
          symbol_name: { type: "string", description: "要查找的符号名称" },
          file_path: { type: "string", description: "限定搜索的文件路径（可选）" }
        },
        required: ["symbol_name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "generate_code",
      description: "生成或修改代码文件，支持创建、追加、插入、替换模式",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "目标文件路径（相对于项目根目录）" },
          content: { type: "string", description: "要写入的代码内容" },
          mode: {
            type: "string",
            enum: ["create", "append", "insert", "replace"],
            description: "写入模式: create-创建新文件, append-追加到末尾, insert-插入到指定行, replace-替换指定行范围"
          },
          insert_position: { type: "integer", description: "insert模式下的插入行号（1-based）" },
          replace_start: { type: "integer", description: "replace模式下的替换起始行（1-based）" },
          replace_end: { type: "integer", description: "replace模式下的替换结束行（1-based，包含）" }
        },
        required: ["file_path", "content", "mode"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "在项目目录中执行shell命令（仅允许安全命令）",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "要执行的命令" },
          working_directory: { type: "string", description: "工作目录（相对于项目根目录，可选）" }
        },
        required: ["command"]
      }
    }
  }
];

// ============================================================
// 工具执行入口
// ============================================================

/**
 * 执行工具调用
 * @param {object} toolCall - OpenAI tool_call 对象
 * @param {string} conversationId - 会话ID，用于隔离工作目录
 * @returns {object} 工具执行结果
 */
export async function executeToolCall(toolCall, conversationId) {
  const { name, arguments: argsStr } = toolCall.function;
  const args = JSON.parse(argsStr);
  const baseDir = path.join(process.cwd(), 'demo_code', conversationId);

  // 确保 baseDir 存在
  await fs.mkdir(baseDir, { recursive: true });

  switch (name) {
    case 'search_codebase': return await searchCodebase(baseDir, args);
    case 'read_file': return await readFile(baseDir, args);
    case 'get_project_structure': return await getProjectStructure(baseDir, args);
    case 'get_symbol_definition': return await getSymbolDefinition(baseDir, args);
    case 'generate_code': return await generateCode(baseDir, args);
    case 'run_command': return await runCommand(baseDir, args);
    default: return { error: `Unknown tool: ${name}` };
  }
}

// ============================================================
// 安全工具函数
// ============================================================

/**
 * 安全路径解析 - 确保路径不会逃逸出 baseDir
 * @param {string} baseDir - 基础目录
 * @param {string} relativePath - 相对路径
 * @returns {string|null} 安全的绝对路径，如果路径越界则返回 null
 */
function safePath(baseDir, relativePath) {
  const resolved = path.resolve(baseDir, relativePath);
  if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
    return null;
  }
  return resolved;
}

/**
 * 递归获取目录下所有文件路径
 * @param {string} dir - 起始目录
 * @param {string[]} [fileList=[]] - 文件列表（递归用）
 * @returns {string[]} 文件路径列表
 */
async function getAllFiles(dir, fileList = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    // 忽略 node_modules 和 .git 目录
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      await getAllFiles(fullPath, fileList);
    } else {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

/**
 * 简单的 glob 模式匹配（支持 * 通配符）
 * @param {string} fileName - 文件名
 * @param {string} pattern - 匹配模式，如 *.tsx
 * @returns {boolean}
 */
function matchPattern(fileName, pattern) {
  // 将 glob 模式转换为正则表达式
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const regex = new RegExp(`^${regexStr}$`, 'i');
  return regex.test(fileName);
}

// ============================================================
// 工具实现
// ============================================================

/**
 * 搜索代码库 - 在文件内容中查找匹配的代码片段
 */
async function searchCodebase(baseDir, args) {
  const { query, file_pattern } = args;
  const MAX_RESULTS = 50;

  try {
    const allFiles = await getAllFiles(baseDir);
    const results = [];

    for (const filePath of allFiles) {
      // 如果提供了文件模式，过滤不匹配的文件
      if (file_pattern && !matchPattern(path.basename(filePath), file_pattern)) {
        continue;
      }

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        const queryLower = query.toLowerCase();

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(queryLower)) {
            results.push({
              file: path.relative(baseDir, filePath),
              line: i + 1,
              content: lines[i].trimEnd()
            });

            // 达到最大结果数时提前返回
            if (results.length >= MAX_RESULTS) {
              return { results, total: results.length, truncated: true };
            }
          }
        }
      } catch {
        // 跳过无法读取的文件（如二进制文件）
        continue;
      }
    }

    return { results, total: results.length };
  } catch (err) {
    return { error: `搜索失败: ${err.message}` };
  }
}

/**
 * 读取文件内容 - 支持行范围读取
 */
async function readFile(baseDir, args) {
  const { path: filePath, start_line, end_line } = args;

  // 安全路径检查
  const resolved = safePath(baseDir, filePath);
  if (!resolved) {
    return { error: "路径越界：不允许访问项目目录之外的文件" };
  }

  try {
    const content = await fs.readFile(resolved, 'utf-8');
    const lines = content.split('\n');
    const totalLines = lines.length;

    // 按行范围切割（1-based）
    const start = start_line ? Math.max(1, start_line) : 1;
    const end = end_line ? Math.min(totalLines, end_line) : totalLines;
    const selectedLines = lines.slice(start - 1, end);

    return {
      content: selectedLines.join('\n'),
      total_lines: totalLines
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { error: `File not found: ${filePath}` };
    }
    return { error: `读取文件失败: ${err.message}` };
  }
}

/**
 * 获取项目目录结构 - 生成树形结构字符串
 */
async function getProjectStructure(baseDir, args) {
  const maxDepth = args.depth || 3;

  try {
    const tree = await buildTree(baseDir, '', 0, maxDepth);
    return { structure: tree };
  } catch (err) {
    return { error: `获取目录结构失败: ${err.message}` };
  }
}

/**
 * 递归构建目录树字符串
 */
async function buildTree(dir, prefix, currentDepth, maxDepth) {
  if (currentDepth >= maxDepth) return '';

  const entries = await fs.readdir(dir, { withFileTypes: true });
  // 排序：目录在前，文件在后
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  let result = '';
  const filteredEntries = entries.filter(
    e => e.name !== 'node_modules' && e.name !== '.git'
  );

  for (let i = 0; i < filteredEntries.length; i++) {
    const entry = filteredEntries[i];
    const isLast = i === filteredEntries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';

    if (entry.isDirectory()) {
      result += `${prefix}${connector}${entry.name}/\n`;
      const subtree = await buildTree(
        path.join(dir, entry.name),
        prefix + childPrefix,
        currentDepth + 1,
        maxDepth
      );
      result += subtree;
    } else {
      result += `${prefix}${connector}${entry.name}\n`;
    }
  }

  return result;
}

/**
 * 查找符号定义 - 搜索 export/function/class/interface/type 声明
 */
async function getSymbolDefinition(baseDir, args) {
  const { symbol_name, file_path } = args;
  const definitions = [];

  // 符号定义匹配的正则模式
  const patterns = [
    // export (const|function|class|interface|type|let|var) symbolName
    new RegExp(`export\\s+(default\\s+)?(const|function|class|interface|type|let|var)\\s+${escapeRegex(symbol_name)}\\b`, 'i'),
    // function symbolName
    new RegExp(`^\\s*(async\\s+)?function\\s+${escapeRegex(symbol_name)}\\s*\\(`, 'i'),
    // class symbolName
    new RegExp(`^\\s*(export\\s+)?(default\\s+)?class\\s+${escapeRegex(symbol_name)}\\b`, 'i'),
    // interface symbolName
    new RegExp(`^\\s*(export\\s+)?interface\\s+${escapeRegex(symbol_name)}\\b`, 'i'),
    // type symbolName
    new RegExp(`^\\s*(export\\s+)?type\\s+${escapeRegex(symbol_name)}\\b`, 'i'),
    // const/let/var symbolName
    new RegExp(`^\\s*(export\\s+)?(const|let|var)\\s+${escapeRegex(symbol_name)}\\b`, 'i')
  ];

  try {
    let filesToSearch = [];

    if (file_path) {
      // 如果指定了文件路径，只搜索该文件
      const resolved = safePath(baseDir, file_path);
      if (!resolved) {
        return { error: "路径越界：不允许访问项目目录之外的文件" };
      }
      filesToSearch = [resolved];
    } else {
      // 搜索所有 JS/TS 文件
      const allFiles = await getAllFiles(baseDir);
      filesToSearch = allFiles.filter(f => /\.(js|ts|tsx|jsx)$/.test(f));
    }

    for (const filePath of filesToSearch) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          for (const pattern of patterns) {
            if (pattern.test(line)) {
              // 判断符号类型
              const type = detectSymbolType(line);
              definitions.push({
                file: path.relative(baseDir, filePath),
                line: i + 1,
                symbol: symbol_name,
                type,
                signature: line.trim()
              });
              break; // 同一行只需匹配一次
            }
          }
        }
      } catch {
        continue;
      }
    }

    return { definitions };
  } catch (err) {
    return { error: `符号查找失败: ${err.message}` };
  }
}

/**
 * 检测符号类型
 */
function detectSymbolType(line) {
  if (/\bfunction\b/.test(line)) return 'function';
  if (/\bclass\b/.test(line)) return 'class';
  if (/\binterface\b/.test(line)) return 'interface';
  if (/\btype\b/.test(line)) return 'type';
  if (/\bconst\b/.test(line)) return 'const';
  if (/\blet\b/.test(line)) return 'let';
  if (/\bvar\b/.test(line)) return 'var';
  return 'unknown';
}

/**
 * 转义正则特殊字符
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 生成/修改代码文件
 */
async function generateCode(baseDir, args) {
  const { file_path, content, mode, insert_position, replace_start, replace_end } = args;

  // 安全路径检查
  const resolved = safePath(baseDir, file_path);
  if (!resolved) {
    return { error: "路径越界：不允许访问项目目录之外的文件" };
  }

  try {
    switch (mode) {
      case 'create': {
        // 自动创建目录
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, content, 'utf-8');
        const lines = content.split('\n').length;
        return { success: true, file_path, mode, lines_affected: lines };
      }

      case 'append': {
        // 追加到文件末尾
        const existing = await fs.readFile(resolved, 'utf-8').catch(() => '');
        const newContent = existing + content;
        await fs.writeFile(resolved, newContent, 'utf-8');
        const lines = content.split('\n').length;
        return { success: true, file_path, mode, lines_affected: lines };
      }

      case 'insert': {
        if (!insert_position || insert_position < 1) {
          return { error: "insert 模式需要提供有效的 insert_position（>= 1）" };
        }
        const fileContent = await fs.readFile(resolved, 'utf-8');
        const lines = fileContent.split('\n');
        const insertLines = content.split('\n');
        // 在指定行前插入
        lines.splice(insert_position - 1, 0, ...insertLines);
        await fs.writeFile(resolved, lines.join('\n'), 'utf-8');
        return { success: true, file_path, mode, lines_affected: insertLines.length };
      }

      case 'replace': {
        if (!replace_start || !replace_end || replace_start < 1 || replace_end < replace_start) {
          return { error: "replace 模式需要提供有效的 replace_start 和 replace_end" };
        }
        const fileContent = await fs.readFile(resolved, 'utf-8');
        const lines = fileContent.split('\n');
        const replaceLines = content.split('\n');
        // 替换指定行范围
        lines.splice(replace_start - 1, replace_end - replace_start + 1, ...replaceLines);
        await fs.writeFile(resolved, lines.join('\n'), 'utf-8');
        return { success: true, file_path, mode, lines_affected: replaceLines.length };
      }

      default:
        return { error: `未知的写入模式: ${mode}` };
    }
  } catch (err) {
    return { error: `代码生成失败: ${err.message}` };
  }
}

/**
 * 执行命令 - 带有白名单安全检查和超时控制
 */
async function runCommand(baseDir, args) {
  const { command, working_directory } = args;

  // 命令白名单检查
  const allowedCommands = ['ls', 'cat', 'find', 'node', 'npm', 'npx', 'echo', 'mkdir'];
  const cmdName = command.trim().split(/\s+/)[0];
  if (!allowedCommands.includes(cmdName)) {
    return { error: `命令不在白名单中，只允许: ${allowedCommands.join(', ')}` };
  }

  // 确定工作目录
  let cwd = baseDir;
  if (working_directory) {
    const resolvedCwd = safePath(baseDir, working_directory);
    if (!resolvedCwd) {
      return { error: "工作目录路径越界：不允许在项目目录之外执行命令" };
    }
    cwd = resolvedCwd;
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: 30000, // 30秒超时
      maxBuffer: 1024 * 1024 // 1MB 输出缓冲
    });

    return {
      stdout: stdout || '',
      stderr: stderr || '',
      exitCode: 0
    };
  } catch (err) {
    // 超时处理
    if (err.killed) {
      return { error: "Command timed out after 30s" };
    }
    // 命令执行失败但有输出
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || err.message,
      exitCode: err.code || 1
    };
  }
}
