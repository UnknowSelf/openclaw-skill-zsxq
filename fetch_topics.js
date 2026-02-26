// fetch_topics.js — 知识星球数据抓取（HTTP API + PDF 解析）
//
// 子命令:
//   node fetch_topics.js topics <group_id> [count] [scope]    获取帖子（scope: all|digests，默认 all）
//   node fetch_topics.js digests <group_id> [count]           获取精华帖（等价于 topics <id> [count] digests）
//   node fetch_topics.js download-pdf <file_id>               下载并解析 PDF 附件
//   node fetch_topics.js groups                               列出已加入的星球
//
// 环境变量:
//   ZSXQ_TOKEN (必须) — 知识星球 zsxq_access_token cookie 值
//
// 输出: JSON 到 stdout，日志到 stderr

const https = require('https');
const { URL } = require('url');

// ── 认证 ────────────────────────────────────────────────────
const ZSXQ_TOKEN = process.env.ZSXQ_TOKEN;
if (!ZSXQ_TOKEN) {
  console.error(JSON.stringify({ error: 'ZSXQ_TOKEN environment variable not set' }));
  process.exit(1);
}

const BASE_URL = 'https://api.zsxq.com/v2';

const HEADERS = {
  'Cookie': `zsxq_access_token=${ZSXQ_TOKEN}`,
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Origin': 'https://wx.zsxq.com',
  'Referer': 'https://wx.zsxq.com/',
  'Accept': 'application/json',
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

    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 指数退避重试
async function httpGetWithRetry(url, options = {}, maxRetries = 3) {
  let lastErr;
  for (let i = 0; i < maxRetries; i++) {
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

// ── 帖子内容解析 ────────────────────────────────────────────
function parseTopicContent(topic) {
  const talk = topic.talk || {};
  const question = topic.question || {};
  const answer = topic.answer || {};

  // 提取文本（talk 类型 / question+answer 类型）
  let text = '';
  if (talk.text) {
    text = talk.text;
  } else if (question.text) {
    text = '【提问】' + question.text;
    if (answer.text) {
      text += '\n【回答】' + answer.text;
    }
  }

  // 提取文件附件（PDF）
  const files = [];
  const allImages = [];

  // talk 附件
  if (talk.files && talk.files.length > 0) {
    for (const f of talk.files) {
      files.push({ file_id: String(f.file_id), name: f.name || '', size: f.size || 0, duration: f.duration || 0 });
    }
  }
  // answer 附件
  if (answer.files && answer.files.length > 0) {
    for (const f of answer.files) {
      files.push({ file_id: String(f.file_id), name: f.name || '', size: f.size || 0, duration: f.duration || 0 });
    }
  }

  // 图片
  if (talk.images && talk.images.length > 0) {
    for (const img of talk.images) {
      allImages.push({ image_id: img.image_id, type: img.type });
    }
  }

  // 只保留 PDF 文件
  const pdfFiles = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));

  // owner 在 talk.owner / question.owner 里
  const ownerObj = talk.owner || question.owner || topic.owner || null;

  return {
    topic_id: String(topic.topic_id),
    type: topic.type,
    title: topic.title || '',
    text: text.substring(0, 2000),
    create_time: topic.create_time,
    owner: ownerObj ? { user_id: String(ownerObj.user_id), name: ownerObj.name } : null,
    likes_count: topic.likes_count || 0,
    comments_count: topic.comments_count || 0,
    reading_count: topic.reading_count || 0,
    readers_count: topic.readers_count || 0,
    digested: topic.digested || false,
    pdf_files: pdfFiles,
    image_count: allImages.length,
  };
}

// ── topics / digests ────────────────────────────────────────
async function fetchTopics() {
  const groupId = process.argv[3];
  const count = parseInt(process.argv[4]) || 20;
  const scope = process.argv[5] || 'all'; // all | digests

  if (!groupId) {
    console.error(JSON.stringify({ error: 'Usage: node fetch_topics.js topics <group_id> [count] [scope]' }));
    process.exit(1);
  }

  const isDigests = scope === 'digests' || subcommand === 'digests';
  const endpoint = isDigests
    ? `${BASE_URL}/groups/${groupId}/topics?scope=digests&count=${Math.min(count, 30)}`
    : `${BASE_URL}/groups/${groupId}/topics?scope=all&count=${Math.min(count, 30)}`;

  console.error(`[zsxq] fetching ${isDigests ? 'digests' : 'all'} topics for group ${groupId} (count=${count})...`);

  const allTopics = [];
  let url = endpoint;
  let pages = 0;
  const maxPages = Math.ceil(count / 20) + 1;

  while (allTopics.length < count && pages < maxPages) {
    try {
      const res = await httpGetWithRetry(url);

      if (res.statusCode !== 200) {
        console.error(`[zsxq] HTTP ${res.statusCode}: ${res.body.substring(0, 300)}`);
        break;
      }

      let data;
      try { data = JSON.parse(res.body); } catch {
        console.error(`[zsxq] non-JSON response: ${res.body.substring(0, 300)}`);
        break;
      }

      if (!data.succeeded) {
        console.error(`[zsxq] API error: ${JSON.stringify(data)}`);
        break;
      }

      const topics = data.resp_data && data.resp_data.topics;
      if (!topics || topics.length === 0) {
        console.error('[zsxq] no more topics');
        break;
      }

      for (const t of topics) {
        allTopics.push(parseTopicContent(t));
        if (allTopics.length >= count) break;
      }

      console.error(`[zsxq] fetched ${allTopics.length}/${count} topics`);

      // 翻页：使用 end_time 参数
      const lastTopic = topics[topics.length - 1];
      if (lastTopic && lastTopic.create_time && allTopics.length < count) {
        // 知识星球使用 end_time 翻页，格式为 ISO 时间去掉毫秒后 URL encode
        const endTime = encodeURIComponent(lastTopic.create_time);
        url = endpoint + `&end_time=${endTime}`;
        pages++;
        await sleep(1000); // 翻页限速
      } else {
        break;
      }
    } catch (err) {
      console.error(`[zsxq] fetch error: ${err.message}`);
      break;
    }
  }

  const result = {
    group_id: groupId,
    scope: isDigests ? 'digests' : 'all',
    count: allTopics.length,
    topics: allTopics,
  };

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
    // 步骤 1：获取下载 URL
    const metaUrl = `${BASE_URL}/files/${fileId}/download_url`;
    const metaRes = await httpGetWithRetry(metaUrl);

    if (metaRes.statusCode !== 200) {
      console.log(JSON.stringify({ error: `HTTP ${metaRes.statusCode}`, file_id: fileId, detail: metaRes.body.substring(0, 300) }));
      return;
    }

    let metaData;
    try { metaData = JSON.parse(metaRes.body); } catch {
      console.log(JSON.stringify({ error: 'non_json_response', file_id: fileId }));
      return;
    }

    if (!metaData.succeeded || !metaData.resp_data || !metaData.resp_data.download_url) {
      console.log(JSON.stringify({ error: 'no_download_url', file_id: fileId, resp: metaData }));
      return;
    }

    const downloadUrl = metaData.resp_data.download_url;
    console.error(`[zsxq] got download URL, fetching PDF...`);

    await sleep(1000); // 限速

    // 步骤 2：下载 PDF 二进制
    const pdfRes = await httpGetWithRetry(downloadUrl, { raw: true, timeout: 30000 });

    if (pdfRes.statusCode !== 200) {
      console.log(JSON.stringify({ error: `PDF download HTTP ${pdfRes.statusCode}`, file_id: fileId }));
      return;
    }

    const pdfBuffer = pdfRes.body;
    console.error(`[zsxq] downloaded ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

    // 步骤 3：解析 PDF 文本
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
      // 可能是扫描件 PDF
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

// ── groups ───────────────────────────────────────────────────
async function fetchGroups() {
  console.error('[zsxq] fetching joined groups...');

  try {
    const res = await httpGetWithRetry(`${BASE_URL}/groups`);

    if (res.statusCode !== 200) {
      console.log(JSON.stringify({ error: `HTTP ${res.statusCode}`, detail: res.body.substring(0, 300) }));
      return;
    }

    let data;
    try { data = JSON.parse(res.body); } catch {
      console.log(JSON.stringify({ error: 'non_json_response' }));
      return;
    }

    if (!data.succeeded) {
      console.log(JSON.stringify({ error: 'api_error', resp: data }));
      return;
    }

    const groups = (data.resp_data && data.resp_data.groups) || [];
    const result = groups.map(g => ({
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
        // digests 是 topics 的快捷方式，scope 固定为 digests
        await fetchTopics();
        break;
      case 'download-pdf':
        await downloadPdf();
        break;
      case 'groups':
        await fetchGroups();
        break;
      default:
        console.error(`Unknown subcommand: ${subcommand}. Use: topics, digests, download-pdf, groups`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`[zsxq] fatal error: ${err.message}`);
    process.exit(1);
  }
})();
