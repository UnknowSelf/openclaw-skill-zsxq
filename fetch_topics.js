// fetch_topics.js — 知识星球数据抓取（HTTP API + PDF/DOCX 解析 + Markdown 导出）
//
// 子命令:
//   node fetch_topics.js export-md <group_id> <YYYY-MM-DD> [scope] [output_dir]
//                                                                 按日期导出帖子为 Markdown 并下载附件
//   node fetch_topics.js parse-doc <doc_dir> [output_dir]        解析指定目录下的所有 PDF 和 DOCX 文件
//   node fetch_topics.js groups                                  列出已加入的星球
//
// 环境变量:
//   ZSXQ_TOKEN (必须，仅 export-md 和 groups 需要) — 知识星球 zsxq_access_token cookie 值
//
// 输出: JSON 到 stdout，日志到 log/ 目录和 stderr

const https = require('https');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

// ── 单例锁机制 ───────────────────────────────────────────────
const LOCK_FILE = path.join(__dirname, '.fetch_topics.lock');

function acquireLock() {
  try {
    // 检查锁文件是否存在
    if (fs.existsSync(LOCK_FILE)) {
      const lockContent = fs.readFileSync(LOCK_FILE, 'utf-8');
      const lockData = JSON.parse(lockContent);
      const lockPid = lockData.pid;
      
      // 检查进程是否还在运行（Windows 和 Unix 兼容）
      try {
        process.kill(lockPid, 0); // 发送信号 0 只检查进程是否存在，不杀死进程
        // 如果没有抛出异常，说明进程还在运行
        console.error(JSON.stringify({
          error: 'Another fetch_topics.js process is already running',
          pid: lockPid,
          started_at: lockData.started_at
        }));
        process.exit(1);
      } catch (err) {
        // 进程不存在，删除过期的锁文件
        fs.unlinkSync(LOCK_FILE);
      }
    }
    
    // 创建锁文件
    const lockData = {
      pid: process.pid,
      started_at: new Date().toISOString()
    };
    fs.writeFileSync(LOCK_FILE, JSON.stringify(lockData, null, 2), 'utf-8');
    
    // 注册退出时清理锁文件
    const cleanupLock = () => {
      try {
        if (fs.existsSync(LOCK_FILE)) {
          const currentLock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
          // 只删除自己创建的锁文件
          if (currentLock.pid === process.pid) {
            fs.unlinkSync(LOCK_FILE);
          }
        }
      } catch (err) {
        // 忽略清理错误
      }
    };
    
    process.on('exit', cleanupLock);
    process.on('SIGINT', () => {
      cleanupLock();
      process.exit(130);
    });
    process.on('SIGTERM', () => {
      cleanupLock();
      process.exit(143);
    });
    process.on('uncaughtException', (err) => {
      console.error('Uncaught exception:', err);
      cleanupLock();
      process.exit(1);
    });
    
  } catch (err) {
    console.error(JSON.stringify({
      error: 'Failed to acquire lock',
      message: err.message
    }));
    process.exit(1);
  }
}

// 在脚本开始时获取锁
acquireLock();

// 尝试加载 pdf-parse 和 mammoth（可选依赖）
let pdfParse;
let mammoth;
try {
  pdfParse = require('pdf-parse');
} catch (err) {
  // pdf-parse 未安装，parse-pdf 命令将不可用
}
try {
  mammoth = require('mammoth');
} catch (err) {
  // mammoth 未安装，docx 解析将不可用
}

// ── 日志系统 ───────────────────────────────────────────────
const LOG_DIR = path.join(__dirname, 'log');
const todayStr = new Date().toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
const logFilePath = path.join(LOG_DIR, `${todayStr}.log`);

// 确保日志目录存在
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (err) {
  info(`failed to create log directory: ${err.message}`);
}

// 写入日志文件（追加模式）
function logToFile(level, message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${level}] ${message}\n`;
  try {
    fs.appendFileSync(logFilePath, logLine, 'utf-8');
  } catch (err) {
    // 如果写入失败，输出到 stderr
    info(`failed to write log: ${err.message}`);
  }
}

// 日志级别
function info(msg) { logToFile('INFO', msg); }
function warn(msg) { logToFile('WARN', msg); }
function error(msg) { logToFile('ERROR', msg); }

// ── 认证 ────────────────────────────────────────────────────
const subcommand = process.argv[2] || 'topics';
const ZSXQ_TOKEN = process.env.ZSXQ_TOKEN;

// parse-doc 命令不需要 token
if (subcommand !== 'parse-doc' && !ZSXQ_TOKEN) {
  const errorMsg = JSON.stringify({ error: 'ZSXQ_TOKEN environment variable not set' });
  console.error(errorMsg);
  error(errorMsg);
  process.exit(1);
}

const BASE_URL = 'https://api.zsxq.com/v2';

const HEADERS = {
  Cookie: `zsxq_access_token=${ZSXQ_TOKEN || ''}`,
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Origin: 'https://wx.zsxq.com',
  Referer: 'https://wx.zsxq.com/',
  Accept: 'application/json',
  'X-Timestamp': String(Math.floor(Date.now() / 1000)),
};

// ── HTTP 请求 ───────────────────────────────────────────────
function httpGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { ...HEADERS, ...(options.headers || {}) },
      timeout: options.timeout || 15000,
    };

    const req = https.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if (options.raw) {
          resolve({ statusCode: res.statusCode, headers: res.headers, body });
        } else {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: body.toString('utf-8') });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 随机延迟 2-5 秒，用于下载请求之间的停顿
function randomSleep() {
  const min = 2000; // 2 秒
  const max = 5000; // 5 秒
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  info(`waiting ${(ms / 1000).toFixed(1)}s before next download...`);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 指数退避重试
async function httpGetWithRetry(url, options = {}, maxRetries = 3) {
  let lastErr;
  for (let i = 0; i < maxRetries; i += 1) {
    try {
      const res = await httpGet(url, options);
      if (res.statusCode === 429) {
        const wait = Math.pow(2, i + 1) * 1000; // 2s, 4s, 8s
        info(`429 rate limited, waiting ${wait}ms...`);
        await sleep(wait);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (i < maxRetries - 1) {
        const wait = Math.pow(2, i + 1) * 1000;
        info(`request error: ${err.message}, retrying in ${wait}ms...`);
        await sleep(wait);
      }
    }
  }
  throw lastErr || new Error('max retries exceeded');
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sanitizeFileName(name) {
  const source = (name || '').trim();
  const cleaned = source
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'unnamed';
}

function toMdPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function escapeMdText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/^#{1,6}\s+/gm, '- ') // 将 Markdown 标题替换为 -
    .replace(/^(\d+)([、.])/gm, '\\$1$2') // 转义数字列表，防止被误识别
    .replace(/^([-=])\1+$/gm, '\\$&') // 转义 Setext 标题下划线（--- 或 ===）
    .replace(/\n/g, '  \n'); // 在每个换行前添加两个空格，实现 Markdown 硬换行
}


function detectExtByHeaders(headers = {}) {
  const contentType = String(headers['content-type'] || '').toLowerCase();
  if (contentType.includes('image/jpeg')) return '.jpg';
  if (contentType.includes('image/png')) return '.png';
  if (contentType.includes('image/gif')) return '.gif';
  if (contentType.includes('image/webp')) return '.webp';
  if (contentType.includes('audio/mpeg')) return '.mp3';
  if (contentType.includes('audio/mp4')) return '.m4a';
  if (contentType.includes('audio/wav')) return '.wav';
  if (contentType.includes('application/pdf')) return '.pdf';
  return '';
}

async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function writeBinaryFile(filePath, buffer) {
  await ensureDir(path.dirname(filePath));
  await fs.promises.writeFile(filePath, buffer);
}

function pickFileExtByName(fileName) {
  const ext = path.extname(fileName || '').trim();
  return ext ? ext.toLowerCase() : '';
}

function buildImageUrlCandidates(image) {
  const urls = [];
  const pushUrl = (value) => {
    if (typeof value === 'string' && value.startsWith('http')) {
      urls.push(value);
    }
  };

  pushUrl(image.url);
  if (image.large && typeof image.large === 'object') pushUrl(image.large.url);
  if (image.original && typeof image.original === 'object') pushUrl(image.original.url);
  if (image.thumbnail && typeof image.thumbnail === 'object') pushUrl(image.thumbnail.url);

  if (image.image_id) {
    const imageId = String(image.image_id);
    const imageType = String(image.type || '').trim();
    if (imageType) {
      urls.push(`${BASE_URL}/images/${imageId}/${imageType}`);
    }
    urls.push(`${BASE_URL}/images/${imageId}/large`);
    urls.push(`${BASE_URL}/images/${imageId}/original`);
    urls.push(`${BASE_URL}/images/${imageId}`);
  }

  return Array.from(new Set(urls));
}

function extractTopicText(topic) {
  const talk = topic.talk || {};
  const question = topic.question || {};
  const answer = topic.answer || {};

  if (talk.text) {
    return talk.text;
  }

  if (question.text) {
    let text = `【提问】${question.text}`;
    if (answer.text) {
      text += `\n【回答】${answer.text}`;
    }
    return text;
  }

  return '';
}

function extractTopicFiles(topic) {
  const talk = topic.talk || {};
  const answer = topic.answer || {};
  const files = [];

  const pushFiles = (items) => {
    if (!Array.isArray(items)) return;
    for (const file of items) {
      files.push({
        file_id: String(file.file_id),
        name: file.name || '',
        size: file.size || 0,
        duration: file.duration || 0,
      });
    }
  };

  pushFiles(talk.files);
  pushFiles(answer.files);

  return files;
}

function extractTopicImages(topic) {
  const talk = topic.talk || {};
  const answer = topic.answer || {};
  const images = [];

  const pushImages = (items) => {
    if (!Array.isArray(items)) return;
    for (const image of items) {
      images.push({
        image_id: image.image_id ? String(image.image_id) : '',
        type: image.type || '',
        url: image.url || '',
        large: image.large || null,
        original: image.original || null,
        thumbnail: image.thumbnail || null,
      });
    }
  };

  pushImages(talk.images);
  pushImages(answer.images);

  return images;
}

async function getFileDownloadUrl(fileId, maxRetries = 3) {
  const metaUrl = `${BASE_URL}/files/${fileId}/download_url`;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const metaRes = await httpGetWithRetry(metaUrl);

      if (metaRes.statusCode !== 200) {
        throw new Error(`download_url HTTP ${metaRes.statusCode}`);
      }

      const metaData = safeJsonParse(metaRes.body);
      if (!metaData) {
        throw new Error('download_url non_json_response');
      }

      if (!metaData.succeeded || !metaData.resp_data || !metaData.resp_data.download_url) {
        throw new Error('download_url missing');
      }

      return metaData.resp_data.download_url;
    } catch (err) {
      if (attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt) * 1000;
        info(`getFileDownloadUrl failed (attempt ${attempt}/${maxRetries}): ${err.message}, retrying in ${waitTime}ms...`);
        await sleep(waitTime);
      } else {
        throw err;
      }
    }
  }
}

async function downloadBinaryFromUrl(url, timeout = 30000, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const fileRes = await httpGetWithRetry(url, { raw: true, timeout });
      if (fileRes.statusCode !== 200) {
        throw new Error(`download HTTP ${fileRes.statusCode}`);
      }
      return fileRes;
    } catch (err) {
      if (attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt) * 1000;
        info(`downloadBinaryFromUrl failed (attempt ${attempt}/${maxRetries}): ${err.message}, retrying in ${waitTime}ms...`);
        await sleep(waitTime);
      } else {
        throw err;
      }
    }
  }
}

async function downloadFileAttachment(file, destDir, fileIndex, topicId) {
  const safeName = sanitizeFileName(file.name || `file_${file.file_id}`);
  const fileName = safeName;
  const absPath = path.join(destDir, fileName);

  // 检查文件是否已存在
  if (fs.existsSync(absPath)) {
    const stats = fs.statSync(absPath);
    info(`file already exists, skipping: ${fileName}`);
    return {
      kind: 'file',
      file_id: file.file_id,
      original_name: file.name,
      saved_name: fileName,
      size: stats.size,
      abs_path: absPath,
    };
  }

  const downloadUrl = await getFileDownloadUrl(file.file_id);
  await sleep(1000);
  const downloadRes = await downloadBinaryFromUrl(downloadUrl, 30000);

  await writeBinaryFile(absPath, downloadRes.body);

  return {
    kind: 'file',
    file_id: file.file_id,
    original_name: file.name,
    saved_name: fileName,
    size: downloadRes.body.length,
    abs_path: absPath,
  };
}

async function downloadImageAttachment(image, destDir, imageIndex, topicId) {
  const candidates = buildImageUrlCandidates(image);
  if (candidates.length === 0) {
    throw new Error('image url missing');
  }

  // 先尝试检查文件是否已存在（需要先确定文件名）
  const extByImageType = image.type ? `.${String(image.type).toLowerCase().replace(/^\./, '')}` : '.jpg';
  const fileName = `image_${image.image_id || imageIndex}${extByImageType}`;
  const absPath = path.join(destDir, sanitizeFileName(fileName));

  if (fs.existsSync(absPath)) {
    const stats = fs.statSync(absPath);
    info(`image already exists, skipping: ${fileName}`);
    return {
      kind: 'image',
      image_id: image.image_id,
      saved_name: path.basename(absPath),
      size: stats.size,
      abs_path: absPath,
      source_url: candidates[0],
    };
  }

  let lastErr;
  for (const candidate of candidates) {
    try {
      const imgRes = await downloadBinaryFromUrl(candidate, 30000);
      const extByType = detectExtByHeaders(imgRes.headers);
      const ext = extByType || extByImageType;
      const finalFileName = `image_${image.image_id || imageIndex}${ext}`;
      const finalAbsPath = path.join(destDir, sanitizeFileName(finalFileName));
      await writeBinaryFile(finalAbsPath, imgRes.body);

      return {
        kind: 'image',
        image_id: image.image_id,
        saved_name: path.basename(finalAbsPath),
        size: imgRes.body.length,
        abs_path: finalAbsPath,
        source_url: candidate,
      };
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('image download failed');
}

function buildTopicMarkdownBlock(topic, downloadedFiles, downloadedImages, fileErrors, imageErrors, mdBaseDir, topicIndex) {
  const lines = [];
  const ownerName = topic.owner && topic.owner.name ? topic.owner.name : '未知';

  lines.push(`## ${topicIndex}`);
  lines.push('');
  lines.push(`- 话题ID: ${topic.topic_id}`);
  // lines.push(`- 作者: ${escapeMdText(ownerName)}`);
  lines.push(`- 时间: ${topic.create_time || ''}`);
  // lines.push(`- 类型: ${topic.type || ''}`);
  // lines.push(`- 精华: ${topic.digested ? '是' : '否'}`);
  // lines.push(`- 互动: 阅读 ${topic.reading_count} / 点赞 ${topic.likes_count} / 评论 ${topic.comments_count}`);
  // lines.push(`- 原帖: https://wx.zsxq.com/topic/${topic.topic_id}`);
  lines.push('');

  if (topic.text) {
    // lines.push('### 正文');
    lines.push('');
    lines.push(escapeMdText(topic.text));
    lines.push('');
  }

  // 只有在有附件或有错误时才添加附件部分
  const hasAttachments = downloadedImages.length > 0 || downloadedFiles.length > 0;
  const hasErrors = fileErrors.length > 0 || imageErrors.length > 0;
  
  if (hasAttachments || hasErrors) {
    // lines.push('### 附件');
    lines.push('');

    if (downloadedImages.length > 0) {
      // lines.push('#### 图片');
      lines.push('');
      for (const image of downloadedImages) {
        const relPath = toMdPath(path.relative(mdBaseDir, image.abs_path));
        lines.push(`- ![${image.saved_name}](${relPath})`);
      }
      lines.push('');
    }

    if (downloadedFiles.length > 0) {
      lines.push('- 文件/音频/文档');
      lines.push('');
      for (const file of downloadedFiles) {
        const relPath = toMdPath(path.relative(mdBaseDir, file.abs_path));
        const displayName = escapeMdText(file.original_name || file.saved_name);
        lines.push(`- [${displayName}](${relPath})`);
      }
      lines.push('');
    }

    if (hasErrors) {
      lines.push('- 下载失败');
      lines.push('');
      for (const err of fileErrors) {
        lines.push(`- 文件 ${err.name || err.id}: ${err.error}`);
      }
      for (const err of imageErrors) {
        lines.push(`- 图片 ${err.id || 'unknown'}: ${err.error}`);
      }
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  return lines.join('\n');
}

// ── export-md ────────────────────────────────────────────────
async function exportTopicsToMarkdown() {
  const groupId = process.argv[3];
  const targetDateStr = process.argv[4]; // YYYY-MM-DD
  const scope = process.argv[5] || 'all';
  const outputArg = process.argv[6] || 'archive';

  if (!groupId || !targetDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(targetDateStr)) {
    const errorMsg = JSON.stringify({ error: 'Usage: node fetch_topics.js export-md <group_id> <YYYY-MM-DD> [scope] [output_dir]' });
    console.error(errorMsg);
    error(errorMsg);
    process.exit(1);
  }

  // 按日期导出模式
  const targetDate = new Date(targetDateStr);
  const month = String(targetDate.getMonth() + 1).padStart(2, '0');
  const day = String(targetDate.getDate()).padStart(2, '0');
  const dateSubDir = `${month}-${day}`;
  
  info(`date mode: exporting topics from ${targetDateStr}`);

  const outputDir = path.resolve(process.cwd(), outputArg);
  const attachmentsRoot = path.join(outputDir, 'asset', dateSubDir);
  const txtimgPath = path.join(outputDir, `${month}-${day}-txtimg.md`);
  const attachmentPath = path.join(outputDir, `${month}-${day}-attachment.md`);

  info(`exporting topics to markdown: group=${groupId}, scope=${scope}`);
  info(`output dir: ${outputDir}`);
  info(`txtimg file: ${month}-${day}-txtimg.md`);
  info(`attachment file: ${month}-${day}-attachment.md`);
  info(`attachments dir: ${attachmentsRoot}`);

  await ensureDir(outputDir);
  await ensureDir(attachmentsRoot);

  // 写入文件头部的辅助函数
  const writeFileHeader = async (filePath, fileType) => {
    const headerLines = [];
    headerLines.push('# 知识星球帖子导出');
    headerLines.push('');
    headerLines.push(`- group_id: ${groupId}`);
    headerLines.push(`- scope: ${scope}`);
    headerLines.push(`- type: ${fileType}`);
    headerLines.push(`- export_mode: date (${targetDateStr})`);
    headerLines.push(`- exported_at: ${new Date().toISOString()}`);
    headerLines.push('');
    headerLines.push('---');
    headerLines.push('');
    await fs.promises.writeFile(filePath, headerLines.join('\n'), 'utf-8');
  };

  // 初始化两个文件
  await writeFileHeader(txtimgPath, 'text and images');
  await writeFileHeader(attachmentPath, 'with document attachments');

  const failures = [];
  let totalFileDownloaded = 0;
  let totalImageDownloaded = 0;
  let txtimgCount = 0;
  let attachmentCount = 0;

  // 定义处理单个帖子的函数
  let topicCounter = 0; // 添加计数器
  const processTopic = async (topic) => {
    topicCounter += 1; // 递增计数器
    info(`processing topic ${topicCounter}: ${topic.topic_id}`);

    const downloadedFiles = [];
    const downloadedImages = [];
    const fileErrors = [];
    const imageErrors = [];

    const files = Array.isArray(topic.files) ? topic.files : [];
    const images = Array.isArray(topic.images) ? topic.images : [];

    // 下载文件
    let fileIndex = 1;
    for (const file of files) {
      // 跳过音频文件
      const fileName = (file.name || '').toLowerCase();
      if (fileName.endsWith('.mp3') || fileName.endsWith('.m4a') || fileName.endsWith('.wav')) {
        info(`skipping audio file: ${file.name}`);
        fileIndex += 1;
        continue;
      }
      
      try {
        const result = await downloadFileAttachment(file, attachmentsRoot, fileIndex, topic.topic_id);
        downloadedFiles.push(result);
        totalFileDownloaded += 1;
      } catch (err) {
        const item = {
          topic_id: topic.topic_id,
          kind: 'file',
          id: file.file_id,
          name: file.name || '',
          error: err.message,
        };
        failures.push(item);
        fileErrors.push(item);
      }

      fileIndex += 1;
      await sleep(1000);
    }

    // 下载图片
    let imageIndex = 1;
    for (const image of images) {
      try {
        const result = await downloadImageAttachment(image, attachmentsRoot, imageIndex, topic.topic_id);
        downloadedImages.push(result);
        totalImageDownloaded += 1;
      } catch (err) {
        const item = {
          topic_id: topic.topic_id,
          kind: 'image',
          id: image.image_id || '',
          name: '',
          error: err.message,
        };
        failures.push(item);
        imageErrors.push(item);
      }

      imageIndex += 1;
      await sleep(1000);
    }
    
    info(`topic ${topic.topic_id}: downloaded ${downloadedFiles.length}/${files.length} files, ${downloadedImages.length}/${images.length} images`);

    // 判断帖子类型：有文档附件 vs 图文
    const hasDocumentAttachment = downloadedFiles.length > 0 || fileErrors.length > 0;
    
    if (hasDocumentAttachment) {
      // 有文档附件的帖子
      attachmentCount += 1;
      const topicMd = buildTopicMarkdownBlock(topic, downloadedFiles, downloadedImages, fileErrors, imageErrors, outputDir, attachmentCount);
      await fs.promises.appendFile(attachmentPath, topicMd, 'utf-8');
    } else {
      // 图文帖子（只有文本和图片）
      txtimgCount += 1;
      const topicMd = buildTopicMarkdownBlock(topic, downloadedFiles, downloadedImages, fileErrors, imageErrors, outputDir, txtimgCount);
      await fs.promises.appendFile(txtimgPath, topicMd, 'utf-8');
    }
  };

  // 按日期模式：边获取边处理
  await fetchAndProcessTopicsByDate(groupId, targetDateStr, scope, processTopic);

  info(`export completed: ${txtimgCount} txtimg topics, ${attachmentCount} attachment topics`);

  // 添加明显的完成日志
  info('========================================');
  info('===== EXPORT-MD COMPLETED =====');
  info('========================================');
  info(`Total topics exported: ${txtimgCount + attachmentCount}`);
  info(`  - Text & Image topics: ${txtimgCount}`);
  info(`  - Document attachment topics: ${attachmentCount}`);
  info(`Files downloaded: ${totalFileDownloaded}`);
  info(`Images downloaded: ${totalImageDownloaded}`);
  info(`Failed downloads: ${failures.length}`);
  info(`Output files:`);
  info(`  - ${txtimgPath}`);
  info(`  - ${attachmentPath}`);
  info(`  - ${attachmentsRoot}`);
  info('========================================');

  console.log(JSON.stringify({
    group_id: groupId,
    scope: scope,
    export_mode: `date (${targetDateStr})`,
    txtimg_count: txtimgCount,
    attachment_count: attachmentCount,
    total_count: txtimgCount + attachmentCount,
    txtimg_file: txtimgPath,
    attachment_file: attachmentPath,
    output_dir: outputDir,
    attachments_dir: attachmentsRoot,
    files_downloaded: totalFileDownloaded,
    images_downloaded: totalImageDownloaded,
    failed_count: failures.length,
    failures,
  }, null, 2));
}

// 按日期获取并处理帖子（流式）
async function fetchAndProcessTopicsByDate(groupId, targetDateStr, scope, processCallback) {
  const isDigests = scope === 'digests';
  const endpoint = isDigests
    ? `${BASE_URL}/groups/${groupId}/topics?scope=digests&count=20`
    : `${BASE_URL}/groups/${groupId}/topics?scope=all&count=20`;

  info(`fetching ${isDigests ? 'digests' : 'all'} topics for date ${targetDateStr}...`);

  const targetDate = new Date(targetDateStr);
  const targetDateOnly = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD
  let processedCount = 0;
  let url = endpoint;
  let pages = 0;
  const maxPages = 50;
  let retryCount = 0;
  const maxRetries = 3;

  while (pages < maxPages) {
    let res;
    try {
      res = await httpGetWithRetry(url);
    } catch (err) {
      info(`fetch error: ${err.message}`);
      break;
    }

    if (res.statusCode !== 200) {
      info(`HTTP ${res.statusCode}: ${res.body.substring(0, 300)}`);
      break;
    }

    const data = safeJsonParse(res.body);

    if (!data.succeeded) {
      retryCount++;
      if (retryCount > maxRetries) {
        info(`API error after ${maxRetries} retries: ${JSON.stringify(data)}`);
        break;
      }
      info(`API error (retry ${retryCount}/${maxRetries}): ${JSON.stringify(data)}`);
      info(`===== RETRYING SAME REQUEST =====`);
      info(`retry URL: ${url}`);
      info(`===================================`);
      
      await sleep(2000); // 等待2秒后重试
      continue;
    }

    // 重置重试计数器（成功后）
    retryCount = 0;

    const topics = data.resp_data && data.resp_data.topics;
    if (!Array.isArray(topics) || topics.length === 0) {
      info('no more topics');
      break;
    }

    let foundOlderThanTarget = false;

    for (const rawTopic of topics) {
      if (!rawTopic.create_time) continue;

      const topicDateOnly = rawTopic.create_time.split('T')[0]; // YYYY-MM-DD
      
      if (topicDateOnly < targetDateOnly) {
        foundOlderThanTarget = true;
        break;
      }

      if (topicDateOnly === targetDateOnly) {
        const files = extractTopicFiles(rawTopic);
        const images = extractTopicImages(rawTopic);
        const ownerObj = (rawTopic.talk && rawTopic.talk.owner) || (rawTopic.question && rawTopic.question.owner) || rawTopic.owner || null;

        const topic = {
          topic_id: String(rawTopic.topic_id),
          type: rawTopic.type,
          title: rawTopic.title || '',
          text: extractTopicText(rawTopic).substring(0, 2000),
          create_time: rawTopic.create_time,
          owner: ownerObj ? { user_id: String(ownerObj.user_id), name: ownerObj.name } : null,
          likes_count: rawTopic.likes_count || 0,
          comments_count: rawTopic.comments_count || 0,
          reading_count: rawTopic.reading_count || 0,
          readers_count: rawTopic.readers_count || 0,
          digested: rawTopic.digested || false,
          files,
          pdf_files: files.filter((file) => file.name.toLowerCase().endsWith('.pdf')),
          images,
          image_count: images.length,
        };

        // 立即处理这个帖子
        await processCallback(topic);
        processedCount += 1;
      }
    }

    info(`page ${pages + 1}: processed ${processedCount} topics for ${targetDateOnly}`);

    if (foundOlderThanTarget) {
      info(`reached topics older than ${targetDateOnly}, stopping`);
      break;
    }

    const lastTopic = topics[topics.length - 1];
    if (lastTopic && lastTopic.create_time) {
      const endTime = encodeURIComponent(lastTopic.create_time);
      url = `${endpoint}&end_time=${endTime}`;
      info(`===== PAGINATION DEBUG =====`);
      info(`raw create_time: ${lastTopic.create_time}`);
      info(`encoded end_time: ${endTime}`);
      info(`full URL: ${url}`);
      info(`============================`);
      pages += 1;
      await randomSleep();
      continue;
    }

    break;
  }
}

// ── parse-doc ────────────────────────────────────────────────
async function parseDocFiles() {
  const docDir = process.argv[3];
  const outputArg = process.argv[4] || 'archive';

  if (!docDir) {
    const errorMsg = JSON.stringify({ error: 'Usage: node fetch_topics.js parse-doc <doc_dir> [output_dir]' });
    console.error(errorMsg);
    error(errorMsg);
    process.exit(1);
  }

  const docDirPath = path.resolve(process.cwd(), docDir);

  if (!fs.existsSync(docDirPath)) {
    const errorMsg = JSON.stringify({ error: `Directory not found: ${docDirPath}` });
    console.error(errorMsg);
    error(errorMsg);
    process.exit(1);
  }

  info(`parsing documents from directory: ${docDirPath}`);

  // 获取当前日期用于文件名
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  const outputDir = path.resolve(process.cwd(), outputArg);
  const outputPath = path.join(outputDir, `${month}-${day}-doc.md`);

  await ensureDir(outputDir);

  // 写入文件头部
  const headerLines = [];
  headerLines.push('# 文档解析结果');
  headerLines.push('');
  headerLines.push(`- source_dir: ${docDirPath}`);
  headerLines.push(`- parsed_at: ${now.toISOString()}`);
  headerLines.push('');
  headerLines.push('---');
  headerLines.push('');
  await fs.promises.writeFile(outputPath, headerLines.join('\n'), 'utf-8');

  // 检查依赖是否可用
  if (!pdfParse) {
    const errorMsg = JSON.stringify({
      error: 'pdf-parse not installed',
      hint: 'Run: npm install',
    });
    console.error(errorMsg);
    error(errorMsg);
    process.exit(1);
  }

  if (!mammoth) {
    const errorMsg = JSON.stringify({
      error: 'mammoth not installed',
      hint: 'Run: npm install',
    });
    console.error(errorMsg);
    error(errorMsg);
    process.exit(1);
  }

  // 递归查找所有 PDF 和 DOCX 文件
  const findDocFiles = (dir) => {
    const results = [];
    const items = fs.readdirSync(dir);

    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        results.push(...findDocFiles(fullPath));
      } else {
        const lowerName = item.toLowerCase();
        if (lowerName.endsWith('.pdf') || lowerName.endsWith('.docx')) {
          results.push(fullPath);
        }
      }
    }

    return results;
  };

  const docFiles = findDocFiles(docDirPath);
  info(`found ${docFiles.length} document files`);

  let parsedCount = 0;
  let skippedCount = 0;
  const failures = [];
  const stats = {
    pdf: { total: 0, parsed: 0, skipped: 0, failed: 0 },
    docx: { total: 0, parsed: 0, skipped: 0, failed: 0 },
  };

  for (const docPath of docFiles) {
    const fileName = path.basename(docPath);
    const fileExt = path.extname(fileName).toLowerCase();
    const fileType = fileExt === '.pdf' ? 'pdf' : 'docx';

    stats[fileType].total += 1;
    info(`parsing ${fileType.toUpperCase()}: ${fileName}`);

    try {
      let text = '';
      let metadata = {};

      if (fileType === 'pdf') {
        // 解析 PDF
        const pdfBuffer = fs.readFileSync(docPath);
        const pdfData = await pdfParse(pdfBuffer);
        text = (pdfData.text || '').trim();
        metadata = {
          pages: pdfData.numpages || 0,
          size_kb: Math.round(pdfBuffer.length / 1024),
        };
      } else {
        // 解析 DOCX
        const docxBuffer = fs.readFileSync(docPath);
        const result = await mammoth.extractRawText({ buffer: docxBuffer });
        text = (result.value || '').trim();
        metadata = {
          size_kb: Math.round(docxBuffer.length / 1024),
        };
      }

      // 如果文本为空或太短，认为是图片文档，跳过
      if (!text || text.length < 50) {
        info(`skipping image-based ${fileType.toUpperCase()}: ${fileName}`);
        skippedCount += 1;
        stats[fileType].skipped += 1;
        continue;
      }

      // 写入 Markdown
      const lines = [];
      lines.push(`## ${fileName}`);
      lines.push('');
      lines.push(`- 文件类型: ${fileType.toUpperCase()}`);
      if (metadata.pages) {
        lines.push(`- 页数: ${metadata.pages}`);
      }
      lines.push(`- 文件大小: ${metadata.size_kb} KB`);
      lines.push(`- 文本长度: ${text.length} 字符`);
      lines.push('');
      lines.push(escapeMdText(text));
      lines.push('');
      lines.push('---');
      lines.push('');

      await fs.promises.appendFile(outputPath, lines.join('\n'), 'utf-8');
      parsedCount += 1;
      stats[fileType].parsed += 1;
      info(`parsed successfully: ${fileName}`);

    } catch (err) {
      info(`failed to parse: ${fileName} - ${err.message}`);
      stats[fileType].failed += 1;
      failures.push({
        file: fileName,
        path: docPath,
        type: fileType,
        error: err.message,
      });
    }
  }

  info(`parsing completed: ${parsedCount} parsed, ${skippedCount} skipped, ${failures.length} failed`);

  console.log(JSON.stringify({
    source_dir: docDirPath,
    output_file: outputPath,
    total_files: docFiles.length,
    parsed_count: parsedCount,
    skipped_count: skippedCount,
    failed_count: failures.length,
    stats,
    failures,
  }, null, 2));
}


// ── groups ───────────────────────────────────────────────────
async function fetchGroups() {
  info('fetching joined groups...');

  try {
    const res = await httpGetWithRetry(`${BASE_URL}/groups`);

    if (res.statusCode !== 200) {
      console.log(JSON.stringify({ error: `HTTP ${res.statusCode}`, detail: res.body.substring(0, 300) }));
      return;
    }

    const data = safeJsonParse(res.body);
    if (!data) {
      console.log(JSON.stringify({ error: 'non_json_response' }));
      return;
    }

    if (!data.succeeded) {
      console.log(JSON.stringify({ error: 'api_error', resp: data }));
      return;
    }

    const groups = (data.resp_data && data.resp_data.groups) || [];
    const result = groups.map((g) => ({
      group_id: String(g.group_id),
      name: g.name,
      description: (g.description || '').substring(0, 200),
      member_count: g.member_count || 0,
      topics_count: g.topics_count || 0,
      owner: g.owner ? { user_id: String(g.owner.user_id), name: g.owner.name } : null,
    }));

    info(`found ${result.length} groups`);
    console.log(JSON.stringify({ groups: result }, null, 2));
  } catch (err) {
    console.log(JSON.stringify({ error: err.message }));
  }
}

// ── main ─────────────────────────────────────────────────────
(async () => {
  try {
    switch (subcommand) {
      case 'export-md':
        await exportTopicsToMarkdown();
        break;
      case 'parse-doc':
        await parseDocFiles();
        break;
      case 'groups':
        await fetchGroups();
        break;
      default:
        const errorMsg = `Unknown subcommand: ${subcommand}. Use: export-md, parse-doc, groups`;
        console.error(errorMsg);
        error(errorMsg);
        process.exit(1);
    }
  } catch (err) {
    info(`fatal error: ${err.message}`);
    process.exit(1);
  }
})();
