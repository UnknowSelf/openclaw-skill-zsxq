// fetch_topics.js — 知识星球数据抓取（HTTP API + PDF/DOCX 解析 + Markdown 导出）
//
// 子命令:
//   node fetch_topics.js topics <group_id> [count] [scope]              获取帖子（scope: all|digests，默认 all）
//   node fetch_topics.js digests <group_id> [count]                     获取精华帖（等价于 topics <id> [count] digests）
//   node fetch_topics.js download-pdf <file_id>                         下载并解析 PDF 附件
//   node fetch_topics.js download-docx <file_id>                        下载并解析 DOCX 附件
//   node fetch_topics.js export-md <group_id> <count|YYYY-MM-DD> [scope] [output_dir]
//                                                                 导出帖子为 Markdown 并下载附件
//                                                                 count: 按数量导出，文件名 MM-DD-HH-mm-ss.md
//                                                                 YYYY-MM-DD: 按日期导出，文件名 MM-DD.md
//   node fetch_topics.js groups                                         列出已加入的星球
//
// 环境变量:
//   ZSXQ_TOKEN (必须) — 知识星球 zsxq_access_token cookie 值
//
// 输出: JSON 到 stdout，日志到 stderr

const https = require('https');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

// ── 认证 ────────────────────────────────────────────────────
const ZSXQ_TOKEN = process.env.ZSXQ_TOKEN;
if (!ZSXQ_TOKEN) {
  console.error(JSON.stringify({ error: 'ZSXQ_TOKEN environment variable not set' }));
  process.exit(1);
}

const BASE_URL = 'https://api.zsxq.com/v2';

const HEADERS = {
  Cookie: `zsxq_access_token=${ZSXQ_TOKEN}`,
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Origin: 'https://wx.zsxq.com',
  Referer: 'https://wx.zsxq.com/',
  Accept: 'application/json',
  'X-Timestamp': String(Math.floor(Date.now() / 1000)),
};

const subcommand = process.argv[2] || 'topics';

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
  console.error(`[zsxq] waiting ${(ms / 1000).toFixed(1)}s before next download...`);
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
        console.error(`[zsxq] 429 rate limited, waiting ${wait}ms...`);
        await sleep(wait);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (i < maxRetries - 1) {
        const wait = Math.pow(2, i + 1) * 1000;
        console.error(`[zsxq] request error: ${err.message}, retrying in ${wait}ms...`);
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

function timestampTag() {
  const d = new Date();
  const parts = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ];
  return `${parts[0]}${parts[1]}${parts[2]}-${parts[3]}${parts[4]}${parts[5]}`;
}

function escapeMdText(text) {
  return String(text || '').replace(/\r\n/g, '\n');
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

async function fetchTopicsData(groupId, count, scope, forceDigests = false) {
  const isDigests = forceDigests || scope === 'digests';
  const limitedCount = Math.max(1, Math.min(Number(count) || 20, 200));
  const endpoint = isDigests
    ? `${BASE_URL}/groups/${groupId}/topics?scope=digests&count=${Math.min(limitedCount, 30)}`
    : `${BASE_URL}/groups/${groupId}/topics?scope=all&count=${Math.min(limitedCount, 30)}`;

  console.error(`[zsxq] fetching ${isDigests ? 'digests' : 'all'} topics for group ${groupId} (count=${limitedCount})...`);

  const allTopics = [];
  let url = endpoint;
  let pages = 0;
  const maxPages = Math.ceil(limitedCount / 20) + 2;
  let retryCount = 0;
  const maxRetries = 3;

  while (allTopics.length < limitedCount && pages < maxPages) {
    let res;
    try {
      res = await httpGetWithRetry(url);
    } catch (err) {
      console.error(`[zsxq] fetch error: ${err.message}`);
      break;
    }

    if (res.statusCode !== 200) {
      console.error(`[zsxq] HTTP ${res.statusCode}: ${res.body.substring(0, 300)}`);
      break;
    }

    const data = safeJsonParse(res.body);
    if (!data) {
      console.error(`[zsxq] non-JSON response: ${res.body.substring(0, 300)}`);
      break;
    }

    if (!data.succeeded) {
      retryCount++;
      if (retryCount > maxRetries) {
        console.error(`[zsxq] API error after ${maxRetries} retries: ${JSON.stringify(data)}`);
        break;
      }
      console.error(`[zsxq] API error (retry ${retryCount}/${maxRetries}): ${JSON.stringify(data)}`);
      console.error(`[zsxq] ===== RETRYING SAME REQUEST =====`);
      console.error(`[zsxq] retry URL: ${url}`);
      console.error(`[zsxq] ===================================`);
      
      await sleep(2000); // 等待2秒后重试
      continue;
    }

    // 重置重试计数器（成功后）
    retryCount = 0;

    const topics = data.resp_data && data.resp_data.topics;
    if (!Array.isArray(topics) || topics.length === 0) {
      console.error('[zsxq] no more topics');
      break;
    }

    for (const topic of topics) {
      const files = extractTopicFiles(topic);
      const images = extractTopicImages(topic);
      const ownerObj = (topic.talk && topic.talk.owner) || (topic.question && topic.question.owner) || topic.owner || null;

      allTopics.push({
        topic_id: String(topic.topic_id),
        type: topic.type,
        title: topic.title || '',
        text: extractTopicText(topic).substring(0, 2000),
        create_time: topic.create_time,
        owner: ownerObj ? { user_id: String(ownerObj.user_id), name: ownerObj.name } : null,
        likes_count: topic.likes_count || 0,
        comments_count: topic.comments_count || 0,
        reading_count: topic.reading_count || 0,
        readers_count: topic.readers_count || 0,
        digested: topic.digested || false,
        files,
        pdf_files: files.filter((file) => file.name.toLowerCase().endsWith('.pdf')),
        images,
        image_count: images.length,
      });

      if (allTopics.length >= limitedCount) break;
    }

    console.error(`[zsxq] fetched ${allTopics.length}/${limitedCount} topics`);

    const lastTopic = topics[topics.length - 1];
    if (lastTopic && lastTopic.create_time && allTopics.length < limitedCount) {
      const endTime = encodeURIComponent(lastTopic.create_time);
      url = `${endpoint}&end_time=${endTime}`;
      console.error(`[zsxq] ===== PAGINATION DEBUG =====`);
      console.error(`[zsxq] raw create_time: ${lastTopic.create_time}`);
      console.error(`[zsxq] encoded end_time: ${endTime}`);
      console.error(`[zsxq] full URL: ${url}`);
      console.error(`[zsxq] ============================`);
      pages += 1;
      await randomSleep();
      continue;
    }

    break;
  }

  return {
    group_id: String(groupId),
    scope: isDigests ? 'digests' : 'all',
    count: allTopics.length,
    topics: allTopics,
  };
}

// 按日期获取帖子，每次获取20条，持续分页直到超出日期范围
async function fetchTopicsByDate(groupId, targetDateStr, scope) {
  const isDigests = scope === 'digests';
  const endpoint = isDigests
    ? `${BASE_URL}/groups/${groupId}/topics?scope=digests&count=20`
    : `${BASE_URL}/groups/${groupId}/topics?scope=all&count=20`;

  console.error(`[zsxq] fetching ${isDigests ? 'digests' : 'all'} topics for date ${targetDateStr}...`);

  const targetDate = new Date(targetDateStr);
  const targetDateOnly = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD
  const allTopics = [];
  let url = endpoint;
  let pages = 0;
  const maxPages = 50; // 最多翻50页，避免无限循环
  let retryCount = 0;
  const maxRetries = 3;

  while (pages < maxPages) {
    let res;
    try {
      res = await httpGetWithRetry(url);
    } catch (err) {
      console.error(`[zsxq] fetch error: ${err.message}`);
      break;
    }

    if (res.statusCode !== 200) {
      console.error(`[zsxq] HTTP ${res.statusCode}: ${res.body.substring(0, 300)}`);
      break;
    }

    const data = safeJsonParse(res.body);
    if (!data) {
      console.error(`[zsxq] non-JSON response: ${res.body.substring(0, 300)}`);
      break;
    }

    if (!data.succeeded) {
      retryCount++;
      if (retryCount > maxRetries) {
        console.error(`[zsxq] API error after ${maxRetries} retries: ${JSON.stringify(data)}`);
        break;
      }
      console.error(`[zsxq] API error (retry ${retryCount}/${maxRetries}): ${JSON.stringify(data)}`);
      console.error(`[zsxq] ===== RETRYING SAME REQUEST =====`);
      console.error(`[zsxq] retry URL: ${url}`);
      console.error(`[zsxq] ===================================`);
      
      await sleep(2000); // 等待2秒后重试
      continue;
    }

    // 重置重试计数器（成功后）
    retryCount = 0;

    const topics = data.resp_data && data.resp_data.topics;
    if (!Array.isArray(topics) || topics.length === 0) {
      console.error('[zsxq] no more topics');
      break;
    }

    let foundOlderThanTarget = false;

    for (const topic of topics) {
      if (!topic.create_time) continue;

      const topicDateOnly = topic.create_time.split('T')[0]; // YYYY-MM-DD
      
      if (topicDateOnly < targetDateOnly) {
        foundOlderThanTarget = true;
        break;
      }

      // 只收集目标日期的帖子
      if (topicDateOnly === targetDateOnly) {
        const files = extractTopicFiles(topic);
        const images = extractTopicImages(topic);
        const ownerObj = (topic.talk && topic.talk.owner) || (topic.question && topic.question.owner) || topic.owner || null;

        allTopics.push({
          topic_id: String(topic.topic_id),
          type: topic.type,
          title: topic.title || '',
          text: extractTopicText(topic).substring(0, 2000),
          create_time: topic.create_time,
          owner: ownerObj ? { user_id: String(ownerObj.user_id), name: ownerObj.name } : null,
          likes_count: topic.likes_count || 0,
          comments_count: topic.comments_count || 0,
          reading_count: topic.reading_count || 0,
          readers_count: topic.readers_count || 0,
          digested: topic.digested || false,
          files,
          pdf_files: files.filter((file) => file.name.toLowerCase().endsWith('.pdf')),
          images,
          image_count: images.length,
        });
      }
    }

    console.error(`[zsxq] page ${pages + 1}: found ${allTopics.length} topics for ${targetDateOnly}`);

    // 如果已经找到比目标日期更早的帖子，停止翻页
    if (foundOlderThanTarget) {
      console.error(`[zsxq] reached topics older than ${targetDateOnly}, stopping`);
      break;
    }

    // 继续翻页
    const lastTopic = topics[topics.length - 1];
    if (lastTopic && lastTopic.create_time) {
      const endTime = encodeURIComponent(lastTopic.create_time);
      url = `${endpoint}&end_time=${endTime}`;
      console.error(`[zsxq] ===== PAGINATION DEBUG =====`);
      console.error(`[zsxq] raw create_time: ${lastTopic.create_time}`);
      console.error(`[zsxq] encoded end_time: ${endTime}`);
      console.error(`[zsxq] full URL: ${url}`);
      console.error(`[zsxq] ============================`);
      pages += 1;
      await randomSleep();
      continue;
    }

    break;
  }

  return {
    group_id: String(groupId),
    scope: isDigests ? 'digests' : 'all',
    count: allTopics.length,
    topics: allTopics,
  };
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
        console.error(`[zsxq] getFileDownloadUrl failed (attempt ${attempt}/${maxRetries}): ${err.message}, retrying in ${waitTime}ms...`);
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
        console.error(`[zsxq] downloadBinaryFromUrl failed (attempt ${attempt}/${maxRetries}): ${err.message}, retrying in ${waitTime}ms...`);
        await sleep(waitTime);
      } else {
        throw err;
      }
    }
  }
}

async function downloadFileAttachment(file, destDir, fileIndex, topicId) {
  const safeName = sanitizeFileName(file.name || `file_${file.file_id}`);

  const downloadUrl = await getFileDownloadUrl(file.file_id);
  await sleep(1000);
  const downloadRes = await downloadBinaryFromUrl(downloadUrl, 30000);

  const fileName = safeName;
  const absPath = path.join(destDir, fileName);
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

  let lastErr;
  for (const candidate of candidates) {
    try {
      const imgRes = await downloadBinaryFromUrl(candidate, 30000);
      const extByType = detectExtByHeaders(imgRes.headers);
      const extByImageType = image.type ? `.${String(image.type).toLowerCase().replace(/^\./, '')}` : '';
      const ext = extByType || extByImageType || '.jpg';
      const fileName = `image_${image.image_id || imageIndex}${ext}`;
      const absPath = path.join(destDir, sanitizeFileName(fileName));
      await writeBinaryFile(absPath, imgRes.body);

      return {
        kind: 'image',
        image_id: image.image_id,
        saved_name: path.basename(absPath),
        size: imgRes.body.length,
        abs_path: absPath,
        source_url: candidate,
      };
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('image download failed');
}

function buildTopicMarkdownBlock(topic, downloadedFiles, downloadedImages, fileErrors, imageErrors, mdBaseDir) {
  const lines = [];
  const ownerName = topic.owner && topic.owner.name ? topic.owner.name : '未知';
  const title = topic.title ? escapeMdText(topic.title) : `话题 ${topic.topic_id}`;

  lines.push(`## ${title}`);
  lines.push('');
  lines.push(`- 话题ID: ${topic.topic_id}`);
  // lines.push(`- 作者: ${escapeMdText(ownerName)}`);
  lines.push(`- 时间: ${topic.create_time || ''}`);
  lines.push(`- 类型: ${topic.type || ''}`);
  // lines.push(`- 精华: ${topic.digested ? '是' : '否'}`);
  // lines.push(`- 互动: 阅读 ${topic.reading_count} / 点赞 ${topic.likes_count} / 评论 ${topic.comments_count}`);
  // lines.push(`- 原帖: https://wx.zsxq.com/topic/${topic.topic_id}`);
  lines.push('');

  if (topic.text) {
    lines.push('### 正文');
    lines.push('');
    lines.push(escapeMdText(topic.text));
    lines.push('');
  }

  // 只有在有附件或有错误时才添加附件部分
  const hasAttachments = downloadedImages.length > 0 || downloadedFiles.length > 0;
  const hasErrors = fileErrors.length > 0 || imageErrors.length > 0;
  
  if (hasAttachments || hasErrors) {
    lines.push('### 附件');
    lines.push('');

    if (downloadedImages.length > 0) {
      lines.push('#### 图片');
      lines.push('');
      for (const image of downloadedImages) {
        const relPath = toMdPath(path.relative(mdBaseDir, image.abs_path));
        lines.push(`- ![${image.saved_name}](${relPath})`);
      }
      lines.push('');
    }

    if (downloadedFiles.length > 0) {
      lines.push('#### 文件/音频/文档');
      lines.push('');
      for (const file of downloadedFiles) {
        const relPath = toMdPath(path.relative(mdBaseDir, file.abs_path));
        const displayName = escapeMdText(file.original_name || file.saved_name);
        lines.push(`- [${displayName}](${relPath})`);
      }
      lines.push('');
    }

    if (hasErrors) {
      lines.push('#### 下载失败');
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

// ── topics / digests ────────────────────────────────────────
async function fetchTopics() {
  const groupId = process.argv[3];
  const count = parseInt(process.argv[4], 10) || 20;
  const scope = process.argv[5] || 'all';

  if (!groupId) {
    console.error(JSON.stringify({ error: 'Usage: node fetch_topics.js topics <group_id> [count] [scope]' }));
    process.exit(1);
  }

  const result = await fetchTopicsData(groupId, count, scope, subcommand === 'digests');
  console.log(JSON.stringify(result, null, 2));
}

// ── download-pdf ────────────────────────────────────────────
async function downloadPdf() {
  const fileId = process.argv[3];
  if (!fileId) {
    console.error(JSON.stringify({ error: 'Usage: node fetch_topics.js download-pdf <file_id>' }));
    process.exit(1);
  }

  console.error(`[zsxq] downloading PDF file_id=${fileId}...`);

  try {
    const metaUrl = `${BASE_URL}/files/${fileId}/download_url`;
    const metaRes = await httpGetWithRetry(metaUrl);

    if (metaRes.statusCode !== 200) {
      console.log(JSON.stringify({ error: `HTTP ${metaRes.statusCode}`, file_id: fileId, detail: metaRes.body.substring(0, 300) }));
      return;
    }

    const metaData = safeJsonParse(metaRes.body);
    if (!metaData) {
      console.log(JSON.stringify({ error: 'non_json_response', file_id: fileId }));
      return;
    }

    if (!metaData.succeeded || !metaData.resp_data || !metaData.resp_data.download_url) {
      console.log(JSON.stringify({ error: 'no_download_url', file_id: fileId, resp: metaData }));
      return;
    }

    const downloadUrl = metaData.resp_data.download_url;
    console.error('[zsxq] got download URL, fetching PDF...');

    await sleep(1000);

    const pdfRes = await httpGetWithRetry(downloadUrl, { raw: true, timeout: 30000 });

    if (pdfRes.statusCode !== 200) {
      console.log(JSON.stringify({ error: `PDF download HTTP ${pdfRes.statusCode}`, file_id: fileId }));
      return;
    }

    const pdfBuffer = pdfRes.body;
    console.error(`[zsxq] downloaded ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

    let pdfParse;
    try {
      pdfParse = require('pdf-parse');
    } catch {
      console.log(JSON.stringify({
        error: 'pdf-parse not installed',
        file_id: fileId,
        hint: 'Run: cd ~/.openclaw/skills/zsxq-summary && npm install',
      }));
      return;
    }

    try {
      const pdfData = await pdfParse(pdfBuffer);
      const text = (pdfData.text || '').trim();
      const truncated = text.length > 10000;

      console.log(JSON.stringify({
        file_id: fileId,
        pages: pdfData.numpages || 0,
        size_kb: Math.round(pdfBuffer.length / 1024),
        text_length: text.length,
        truncated,
        text: truncated ? text.substring(0, 10000) : text,
      }, null, 2));
    } catch (parseErr) {
      console.log(JSON.stringify({
        file_id: fileId,
        error: 'pdf_parse_failed',
        message: parseErr.message,
        size_kb: Math.round(pdfBuffer.length / 1024),
        hint: '可能是扫描件 PDF，无法提取文本',
      }));
    }
  } catch (err) {
    console.log(JSON.stringify({ error: err.message, file_id: fileId }));
  }
}

// ── download-docx ───────────────────────────────────────────
async function downloadDocx() {
  const fileId = process.argv[3];
  if (!fileId) {
    console.error(JSON.stringify({ error: 'Usage: node fetch_topics.js download-docx <file_id>' }));
    process.exit(1);
  }

  console.error(`[zsxq] downloading DOCX file_id=${fileId}...`);

  try {
    const metaUrl = `${BASE_URL}/files/${fileId}/download_url`;
    const metaRes = await httpGetWithRetry(metaUrl);

    if (metaRes.statusCode !== 200) {
      console.log(JSON.stringify({ error: `HTTP ${metaRes.statusCode}`, file_id: fileId, detail: metaRes.body.substring(0, 300) }));
      return;
    }

    const metaData = safeJsonParse(metaRes.body);
    if (!metaData) {
      console.log(JSON.stringify({ error: 'non_json_response', file_id: fileId }));
      return;
    }

    if (!metaData.succeeded || !metaData.resp_data || !metaData.resp_data.download_url) {
      console.log(JSON.stringify({ error: 'no_download_url', file_id: fileId, resp: metaData }));
      return;
    }

    const downloadUrl = metaData.resp_data.download_url;
    console.error('[zsxq] got download URL, fetching DOCX...');

    await sleep(1000);

    const docxRes = await httpGetWithRetry(downloadUrl, { raw: true, timeout: 30000 });

    if (docxRes.statusCode !== 200) {
      console.log(JSON.stringify({ error: `DOCX download HTTP ${docxRes.statusCode}`, file_id: fileId }));
      return;
    }

    const docxBuffer = docxRes.body;
    console.error(`[zsxq] downloaded ${(docxBuffer.length / 1024).toFixed(1)} KB`);

    let mammoth;
    try {
      mammoth = require('mammoth');
    } catch {
      console.log(JSON.stringify({
        error: 'mammoth not installed',
        file_id: fileId,
        hint: 'Run: cd ~/.openclaw/skills/zsxq-summary && npm install',
      }));
      return;
    }

    try {
      const result = await mammoth.extractRawText({ buffer: docxBuffer });
      const text = (result.value || '').trim();
      const truncated = text.length > 10000;

      console.log(JSON.stringify({
        file_id: fileId,
        size_kb: Math.round(docxBuffer.length / 1024),
        text_length: text.length,
        truncated,
        text: truncated ? text.substring(0, 10000) : text,
      }, null, 2));
    } catch (parseErr) {
      console.log(JSON.stringify({
        file_id: fileId,
        error: 'docx_parse_failed',
        message: parseErr.message,
        size_kb: Math.round(docxBuffer.length / 1024),
        hint: '无法提取 DOCX 文本',
      }));
    }
  } catch (err) {
    console.log(JSON.stringify({ error: err.message, file_id: fileId }));
  }
}

// ── export-md ────────────────────────────────────────────────
async function exportTopicsToMarkdown() {
  const groupId = process.argv[3];
  const countOrDate = process.argv[4]; // 可以是数量或日期 (YYYY-MM-DD)
  const scope = process.argv[5] || 'all';
  const outputArg = process.argv[6] || 'archive';

  if (!groupId) {
    console.error(JSON.stringify({ error: 'Usage: node fetch_topics.js export-md <group_id> <count|YYYY-MM-DD> [scope] [output_dir]' }));
    process.exit(1);
  }

  // 判断是按数量还是按日期导出
  const isDateMode = countOrDate && /^\d{4}-\d{2}-\d{2}$/.test(countOrDate);
  let count = 20;
  let mdFileName = '';
  let dateSubDir = ''; // 用于附件子目录

  if (isDateMode) {
    // 按日期导出模式
    const targetDate = new Date(countOrDate);
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    const day = String(targetDate.getDate()).padStart(2, '0');
    mdFileName = `${month}-${day}.md`;
    dateSubDir = `${month}-${day}`;
    console.error(`[zsxq] date mode: exporting topics from ${countOrDate}`);
  } else {
    // 按数量导出模式
    count = parseInt(countOrDate, 10) || 20;
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    mdFileName = `${month}-${day}-${hour}-${minute}-${second}.md`;
    dateSubDir = `${month}-${day}`;
    console.error(`[zsxq] count mode: exporting ${count} topics`);
  }

  const outputDir = path.resolve(process.cwd(), outputArg);
  const attachmentsRoot = path.join(outputDir, 'asset', dateSubDir);
  const markdownPath = path.join(outputDir, mdFileName);

  console.error(`[zsxq] exporting topics to markdown: group=${groupId}, scope=${scope}`);
  console.error(`[zsxq] output dir: ${outputDir}`);
  console.error(`[zsxq] markdown file: ${mdFileName}`);
  console.error(`[zsxq] attachments dir: ${attachmentsRoot}`);

  await ensureDir(outputDir);
  await ensureDir(attachmentsRoot);

  const failures = [];
  let totalFileDownloaded = 0;
  let totalImageDownloaded = 0;
  let topicsCount = 0;
  let currentFileIndex = 1;
  let topicsInCurrentFile = 0;
  const topicsPerFile = 80; // 每4页（4 * 20 = 80个帖子）生成一个文件
  
  // 生成当前文件名
  const getMarkdownFileName = (fileIndex) => {
    if (isDateMode) {
      const targetDate = new Date(countOrDate);
      const month = String(targetDate.getMonth() + 1).padStart(2, '0');
      const day = String(targetDate.getDate()).padStart(2, '0');
      return `${month}-${day}-${String(fileIndex).padStart(2, '0')}.md`;
    } else {
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hour = String(now.getHours()).padStart(2, '0');
      const minute = String(now.getMinutes()).padStart(2, '0');
      const second = String(now.getSeconds()).padStart(2, '0');
      return `${month}-${day}-${hour}-${minute}-${second}-${String(fileIndex).padStart(2, '0')}.md`;
    }
  };
  
  let currentMarkdownPath = path.join(outputDir, getMarkdownFileName(currentFileIndex));
  
  // 写入当前文件的头部
  const writeFileHeader = async (filePath, fileIndex) => {
    const headerLines = [];
    headerLines.push('# 知识星球帖子导出');
    headerLines.push('');
    headerLines.push(`- group_id: ${groupId}`);
    headerLines.push(`- scope: ${scope}`);
    headerLines.push(`- file_index: ${fileIndex}`);
    if (isDateMode) {
      headerLines.push(`- export_mode: date (${countOrDate})`);
    } else {
      headerLines.push(`- export_mode: count (${count})`);
    }
    headerLines.push(`- exported_at: ${new Date().toISOString()}`);
    headerLines.push('');
    headerLines.push('---');
    headerLines.push('');
    await fs.promises.writeFile(filePath, headerLines.join('\n'), 'utf-8');
  };
  
  await writeFileHeader(currentMarkdownPath, currentFileIndex);

  // 定义处理单个帖子的函数
  const processTopic = async (topic) => {
    topicsCount += 1;
    topicsInCurrentFile += 1;
    
    // 检查是否需要创建新文件
    if (topicsInCurrentFile > topicsPerFile) {
      console.error(`[zsxq] completed file ${currentFileIndex} with ${topicsInCurrentFile - 1} topics`);
      currentFileIndex += 1;
      topicsInCurrentFile = 1;
      currentMarkdownPath = path.join(outputDir, getMarkdownFileName(currentFileIndex));
      await writeFileHeader(currentMarkdownPath, currentFileIndex);
      console.error(`[zsxq] starting new file ${currentFileIndex}: ${path.basename(currentMarkdownPath)}`);
    }
    
    console.error(`[zsxq] processing topic ${topicsCount} (file ${currentFileIndex}, topic ${topicsInCurrentFile}): ${topic.topic_id}`);

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
        console.error(`[zsxq] skipping audio file: ${file.name}`);
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
    
    console.error(`[zsxq] topic ${topic.topic_id}: downloaded ${downloadedFiles.length}/${files.length} files, ${downloadedImages.length}/${images.length} images`);

    // 生成帖子的 Markdown 内容并立即追加到当前文件
    const topicMd = buildTopicMarkdownBlock(topic, downloadedFiles, downloadedImages, fileErrors, imageErrors, outputDir);
    await fs.promises.appendFile(currentMarkdownPath, topicMd, 'utf-8');
  };

  // 根据模式选择不同的处理方式
  if (isDateMode) {
    // 按日期模式：边获取边处理
    await fetchAndProcessTopicsByDate(groupId, countOrDate, scope, processTopic);
  } else {
    // 按数量模式：边获取边处理
    await fetchAndProcessTopicsByCount(groupId, count, scope, processTopic);
  }

  console.error(`[zsxq] completed file ${currentFileIndex} with ${topicsInCurrentFile} topics`);
  console.error(`[zsxq] total files created: ${currentFileIndex}`);

  console.log(JSON.stringify({
    group_id: groupId,
    scope: scope,
    export_mode: isDateMode ? `date (${countOrDate})` : `count (${count})`,
    topics_count: topicsCount,
    files_count: currentFileIndex,
    output_dir: outputDir,
    attachments_dir: attachmentsRoot,
    files_downloaded: totalFileDownloaded,
    images_downloaded: totalImageDownloaded,
    failed_count: failures.length,
    failures,
  }, null, 2));
}

// 按数量获取并处理帖子（流式）
async function fetchAndProcessTopicsByCount(groupId, count, scope, processCallback) {
  const isDigests = scope === 'digests';
  const limitedCount = Math.max(1, Math.min(Number(count) || 20, 200));
  const endpoint = isDigests
    ? `${BASE_URL}/groups/${groupId}/topics?scope=digests&count=20`
    : `${BASE_URL}/groups/${groupId}/topics?scope=all&count=20`;

  console.error(`[zsxq] fetching ${isDigests ? 'digests' : 'all'} topics for group ${groupId} (count=${limitedCount})...`);

  let processedCount = 0;
  let url = endpoint;
  let pages = 0;
  const maxPages = Math.ceil(limitedCount / 20) + 2;
  let retryCount = 0;
  const maxRetries = 3;

  while (processedCount < limitedCount && pages < maxPages) {
    let res;
    try {
      res = await httpGetWithRetry(url);
    } catch (err) {
      console.error(`[zsxq] fetch error: ${err.message}`);
      break;
    }

    if (res.statusCode !== 200) {
      console.error(`[zsxq] HTTP ${res.statusCode}: ${res.body.substring(0, 300)}`);
      break;
    }

    const data = safeJsonParse(res.body);
    if (!data) {
      console.error(`[zsxq] non-JSON response: ${res.body.substring(0, 300)}`);
      break;
    }

    if (!data.succeeded) {
      retryCount++;
      if (retryCount > maxRetries) {
        console.error(`[zsxq] API error after ${maxRetries} retries: ${JSON.stringify(data)}`);
        break;
      }
      console.error(`[zsxq] API error (retry ${retryCount}/${maxRetries}): ${JSON.stringify(data)}`);
      console.error(`[zsxq] ===== RETRYING SAME REQUEST =====`);
      console.error(`[zsxq] retry URL: ${url}`);
      console.error(`[zsxq] ===================================`);
      
      await sleep(2000); // 等待2秒后重试
      continue;
    }

    // 重置重试计数器（成功后）
    retryCount = 0;

    const topics = data.resp_data && data.resp_data.topics;
    if (!Array.isArray(topics) || topics.length === 0) {
      console.error('[zsxq] no more topics');
      break;
    }

    for (const rawTopic of topics) {s(rawTopic);
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

      if (processedCount >= limitedCount) break;
    }

    console.error(`[zsxq] processed ${processedCount}/${limitedCount} topics`);

    const lastTopic = topics[topics.length - 1];
    if (lastTopic && lastTopic.create_time && processedCount < limitedCount) {
      const endTime = encodeURIComponent(lastTopic.create_time);
      url = `${endpoint}&end_time=${endTime}`;
      console.error(`[zsxq] ===== PAGINATION DEBUG =====`);
      console.error(`[zsxq] raw create_time: ${lastTopic.create_time}`);
      console.error(`[zsxq] encoded end_time: ${endTime}`);
      console.error(`[zsxq] full URL: ${url}`);
      console.error(`[zsxq] ============================`);
      pages += 1;
      await randomSleep();
      continue;
    }

    break;
  }
}

// 按日期获取并处理帖子（流式）
async function fetchAndProcessTopicsByDate(groupId, targetDateStr, scope, processCallback) {
  const isDigests = scope === 'digests';
  const endpoint = isDigests
    ? `${BASE_URL}/groups/${groupId}/topics?scope=digests&count=20`
    : `${BASE_URL}/groups/${groupId}/topics?scope=all&count=20`;

  console.error(`[zsxq] fetching ${isDigests ? 'digests' : 'all'} topics for date ${targetDateStr}...`);

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
      console.error(`[zsxq] fetch error: ${err.message}`);
      break;
    }

    if (res.statusCode !== 200) {
      console.error(`[zsxq] HTTP ${res.statusCode}: ${res.body.substring(0, 300)}`);
      break;
    }

    const data = safeJsonParse(res.body);

    if (!data.succeeded) {
      retryCount++;
      if (retryCount > maxRetries) {
        console.error(`[zsxq] API error after ${maxRetries} retries: ${JSON.stringify(data)}`);
        break;
      }
      console.error(`[zsxq] API error (retry ${retryCount}/${maxRetries}): ${JSON.stringify(data)}`);
      console.error(`[zsxq] ===== RETRYING SAME REQUEST =====`);
      console.error(`[zsxq] retry URL: ${url}`);
      console.error(`[zsxq] ===================================`);
      
      await sleep(2000); // 等待2秒后重试
      continue;
    }

    // 重置重试计数器（成功后）
    retryCount = 0;

    const topics = data.resp_data && data.resp_data.topics;
    if (!Array.isArray(topics) || topics.length === 0) {
      console.error('[zsxq] no more topics');
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

    console.error(`[zsxq] page ${pages + 1}: processed ${processedCount} topics for ${targetDateOnly}`);

    if (foundOlderThanTarget) {
      console.error(`[zsxq] reached topics older than ${targetDateOnly}, stopping`);
      break;
    }

    const lastTopic = topics[topics.length - 1];
    if (lastTopic && lastTopic.create_time) {
      const endTime = encodeURIComponent(lastTopic.create_time);
      url = `${endpoint}&end_time=${endTime}`;
      console.error(`[zsxq] ===== PAGINATION DEBUG =====`);
      console.error(`[zsxq] raw create_time: ${lastTopic.create_time}`);
      console.error(`[zsxq] encoded end_time: ${endTime}`);
      console.error(`[zsxq] full URL: ${url}`);
      console.error(`[zsxq] ============================`);
      pages += 1;
      await randomSleep();
      continue;
    }

    break;
  }
}

// ── groups ───────────────────────────────────────────────────
async function fetchGroups() {
  console.error('[zsxq] fetching joined groups...');

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

    console.error(`[zsxq] found ${result.length} groups`);
    console.log(JSON.stringify({ groups: result }, null, 2));
  } catch (err) {
    console.log(JSON.stringify({ error: err.message }));
  }
}

// ── main ─────────────────────────────────────────────────────
(async () => {
  try {
    switch (subcommand) {
      case 'topics':
        await fetchTopics();
        break;
      case 'digests':
        await fetchTopics();
        break;
      case 'download-pdf':
        await downloadPdf();
        break;
      case 'download-docx':
        await downloadDocx();
        break;
      case 'export-md':
        await exportTopicsToMarkdown();
        break;
      case 'groups':
        await fetchGroups();
        break;
      default:
        console.error(`Unknown subcommand: ${subcommand}. Use: topics, digests, download-pdf, download-docx, export-md, groups`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`[zsxq] fatal error: ${err.message}`);
    process.exit(1);
  }
})();
