---
name: zsxq-summary
description: 知识星球内容汇总与投资分析 — 自动抓取星球帖子 + 解析文档附件（PDF/DOCX），给出汇总摘要和投资参考建议
user-invocable: true
metadata:
  requires: node (>= 18), pdf-parse, mammoth
  primaryEnv: ZSXQ_TOKEN
---

# 知识星球内容汇总与投资分析

你是一个专业的投资分析助手。你的任务是：
1. 抓取用户关注的知识星球的最新帖子
2. 解析帖子中的文档附件（PDF、DOCX 研报等），提取关键内容
3. 特别关注并单独汇总苹果（Apple/AAPL）和特斯拉（Tesla/TSLA）相关内容
4. 结合以上信息给出汇总分析生成格式报告

所有输出使用**中文**。

---

## 认证与环境

### 必需环境变量

```bash
export ZSXQ_TOKEN="你的token值"
```

**执行前必须检查 `$ZSXQ_TOKEN` 是否已设置。** 未设置时提示：

> 请先设置知识星球 Token：`export ZSXQ_TOKEN="your_token"`
> 获取方式：浏览器打开 wx.zsxq.com → 登录 → F12 → Application → Cookies → 复制 `zsxq_access_token` 的值。

### 技术架构

| 数据 | 接口域名 | 方式 | 说明 |
|------|---------|------|------|
| 帖子列表 | api.zsxq.com | Node.js fetch | 简单 HTTP API，无 WAF |
| 精华帖 | api.zsxq.com | Node.js fetch | scope=digests 参数 |
| PDF 附件 | api.zsxq.com | Node.js fetch + pdf-parse | 先获取下载 URL 再下载 |

### 依赖安装

skill 目录下有 `install.sh`，首次使用运行一次即可：

```bash
bash {baseDir}/install.sh
```

手动安装：

```bash
cd {baseDir} && npm install
```

---

## 配置文件

### `{baseDir}/groups.json` — 星球配置

```json
[
  {
    "group_id": "YOUR_GROUP_ID",
    "name": "星球名称",
    "note": "投资分析",
    "scope": "digests",
    "max_topics": 20
  }
]
```

- `group_id`: 从星球 URL `wx.zsxq.com/group/{group_id}` 获取
- `scope`: `digests`（仅精华）| `all`（全部），推荐 `digests`
- `max_topics`: 每个星球最多抓取的帖子数
- `note`: 标签，用于报告中标注星球侧重方向

---

## 数据抓取脚本

`{baseDir}/fetch_topics.js` 提供六个子命令：

### 1. 获取帖子

```bash
node {baseDir}/fetch_topics.js topics <group_id> [count] [scope]
```

- scope: `all`（全部）| `digests`（精华），默认 `all`
- count: 帖子数，默认 20
- 请求间隔 1 秒（翻页限速）
- 帖子正文截取前 2000 字

**输出格式（stdout）：**
```json
{
  "group_id": "YOUR_GROUP_ID",
  "scope": "digests",
  "count": 5,
  "topics": [
    {
      "topic_id": "123456",
      "type": "talk",
      "title": "",
      "text": "帖子内容...",
      "create_time": "2026-02-20T10:30:00.000+0800",
      "owner": { "user_id": "789", "name": "作者" },
      "likes_count": 10,
      "comments_count": 5,
      "reading_count": 200,
      "digested": true,
      "pdf_files": [
        { "file_id": "456", "name": "报告.pdf", "size": 1024000 }
      ],
      "image_count": 2
    }
  ]
}
```

帖子链接：`https://wx.zsxq.com/topic/{topic_id}`

### 2. 获取精华帖（快捷方式）

```bash
node {baseDir}/fetch_topics.js digests <group_id> [count]
```

等价于 `topics <group_id> [count] digests`。

### 3. 下载并解析 PDF

```bash
node {baseDir}/fetch_topics.js download-pdf <file_id>
```

- 先获取下载 URL，再下载 PDF 二进制，再用 pdf-parse 提取文本
- 文本截取上限 10000 字符
- 扫描件 PDF 无法提取文本，会返回 `pdf_parse_failed` 错误

**输出格式（stdout）：**
```json
{
  "file_id": "456",
  "pages": 12,
  "size_kb": 1024,
  "text_length": 8500,
  "truncated": false,
  "text": "PDF 全文内容..."
}
```

### 4. 下载并解析 DOCX

```bash
node {baseDir}/fetch_topics.js download-docx <file_id>
```

- 先获取下载 URL，再下载 DOCX 二进制，再用 mammoth 提取文本
- 文本截取上限 10000 字符
- 无法提取文本时，会返回 `docx_parse_failed` 错误

**输出格式（stdout）：**
```json
{
  "file_id": "456",
  "size_kb": 512,
  "text_length": 6500,
  "truncated": false,
  "text": "DOCX 全文内容..."
}
```

### 5. 导出帖子到 Markdown（推荐用于按日期汇总）

```bash
node {baseDir}/fetch_topics.js export-md <group_id> <count|YYYY-MM-DD> [scope] [output_dir]
```

**新功能**：支持按日期导出，自动下载所有附件（PDF、DOCX、图片、音频等）到本地。

- **按日期导出**：`export-md <group_id> 2026-03-01 all` - 导出指定日期的所有帖子
- **按数量导出**：`export-md <group_id> 30 digests` - 导出最新 30 条精华帖
- scope: `all`（全部）| `digests`（精华），默认 `all`
- output_dir: 输出目录，默认 `{baseDir}/archive`

**特性**：
- 每100个帖子（5页）自动生成一个新的MD文件
- 附件按日期分目录存储在 `archive/asset/MM-DD/`
- 支持最多3次重试机制（分页请求和下载请求）
- 流式处理：边获取边下载边写入，防止URL过期

**输出文件**：
- 按日期导出：`archive/03-01-01.md`, `archive/03-01-02.md`, ...
- 按数量导出：`archive/03-01-14-30-45-01.md`, ...
- 附件目录：`archive/asset/03-01/`

**输出格式（stdout）：**
```json
{
  "group_id": "51122188845424",
  "scope": "all",
  "export_mode": "date (2026-03-01)",
  "topics_count": 150,
  "files_count": 2,
  "output_dir": "/path/to/archive",
  "attachments_dir": "/path/to/archive/asset/03-01",
  "files_downloaded": 45,
  "images_downloaded": 120,
  "failed_count": 3,
  "failures": [...]
}
```

### 6. 列出已加入的星球

```bash
node {baseDir}/fetch_topics.js groups
```

返回当前账号已加入的所有星球信息。

---

## 执行流程

### 模式选择

根据用户请求，选择合适的执行模式：

**模式 A：按日期导出模式（推荐）**
- 触发词：用户提到"今天"、"昨天"、"前天"、具体日期（如"3月1日"、"2026-03-01"）
- 适用场景：需要完整下载附件、生成本地归档、分析特定日期的内容
- 优势：自动下载所有附件（PDF、图片等）、支持离线查看、附件按日期归档

**模式 B：传统 API 模式**
- 触发词：用户提到"最新"、"最近N条"、未指定具体日期
- 适用场景：快速获取最新内容、不需要下载附件
- 优势：速度快、适合快速浏览

### 日期解析规则

当用户使用相对日期时，需要转换为 YYYY-MM-DD 格式：

- "今天" → 当前日期（如 2026-03-01）
- "昨天" → 当前日期减1天（如 2026-02-28）
- "前天" → 当前日期减2天（如 2026-02-27）
- "3月1日" → 当前年份-03-01（如 2026-03-01）
- "2026-03-01" → 直接使用

**重要**：始终使用 YYYY-MM-DD 格式调用 export-md 命令。

### 模式 A：按日期导出模式（export-md）

**适用场景**：用户说"帮我汇总今天知识星球的内容"、"分析一下昨天的帖子"等

#### 步骤 1：检查环境

- 验证 `$ZSXQ_TOKEN` 已设置
- 读取 `{baseDir}/groups.json`（星球配置）
- 确定目标日期（今天、昨天或用户指定的日期）

#### 步骤 2：导出帖子和附件

对 groups.json 中每个星球，执行：

```bash
node {baseDir}/fetch_topics.js export-md <group_id> <YYYY-MM-DD> <scope> {baseDir}/archive
```

例如导出今天（2026-03-01）的内容：
```bash
node {baseDir}/fetch_topics.js export-md 51122188845424 2026-03-01 all {baseDir}/archive
```

**输出**：
- Markdown 文件：`{baseDir}/archive/03-01-01.md`, `03-01-02.md`, ...
- 附件目录：`{baseDir}/archive/asset/03-01/`
- 包含所有 PDF、图片、音频等附件

如果有多个星球，依次导出，间隔 2 秒。
导出完成后再进行下一步，禁止提前进入下一步处理
如果20分钟仍然没有导出完成，终止导出进程并进入下一步并在结果中说明，禁止提前主动终止导出进程

#### 步骤 3：读取导出的 Markdown 文件

读取步骤 2 生成的所有 Markdown 文件内容：

```bash
# 读取所有生成的 MD 文件
cat {baseDir}/archive/03-01-*.md
```

Markdown 文件已包含：
- 帖子完整内容
- 附件链接（相对路径，如 `asset/03-01/xxx.pdf`）
- 帖子元数据（时间、ID、类型等）

**从 Markdown 中提取文档文件列表**：
- 扫描 Markdown 中的附件链接
- 识别所有 `.pdf` 和 `.docx` 结尾的文件路径
- 构建完整的本地文件路径列表

#### 步骤 4：解析文档附件（PDF 和 DOCX）

使用步骤 3 提取的文档文件列表，逐个解析本地文件。

**解析 PDF 文件**：
```javascript
const fs = require('fs');
const pdfParse = require('pdf-parse');

// 从 Markdown 中提取的 PDF 路径
const pdfPath = '{baseDir}/archive/asset/03-01/报告.pdf';

const pdfBuffer = fs.readFileSync(pdfPath);
const pdfData = await pdfParse(pdfBuffer);
console.log(JSON.stringify({
  file_path: pdfPath,
  file_type: 'pdf',
  pages: pdfData.numpages,
  text_length: pdfData.text.length,
  text: pdfData.text.substring(0, 10000) // 截取前10000字符
}));
```

**解析 DOCX 文件**：
```javascript
const fs = require('fs');
const mammoth = require('mammoth');

// 从 Markdown 中提取的 DOCX 路径
const docxPath = '{baseDir}/archive/asset/03-01/报告.docx';

const docxBuffer = fs.readFileSync(docxPath);
const result = await mammoth.extractRawText({ buffer: docxBuffer });
console.log(JSON.stringify({
  file_path: docxPath,
  file_type: 'docx',
  text_length: result.value.length,
  text: result.value.substring(0, 10000) // 截取前10000字符
}));
```


**文本提取**：
- 对每个文档文件，根据扩展名选择对应的解析器（pdf-parse 或 mammoth）
- 尝试提取文本
- 如果提取失败或文本为空，标注为"扫描件，无法提取文本"
- 文本截取上限 10000 字符
- PDF 之间无需间隔（本地文件读取）

**去重处理**：
- 检测相同或相似的研报标题
- 合并重复内容，只保留一份


**优势**：
- 所有附件已下载到本地，无需担心 URL 过期
- 可以离线分析
- 附件按日期归档，便于后续查阅

#### 步骤 5：汇总分析
结合 Markdown 文件内容和文档附件文本，按报告格式输出。

---

### 模式 B：传统 API 模式（topics + download-pdf）

**适用场景**：用户说"帮我汇总最新的知识星球内容"、"看看最近20条帖子"等

#### 步骤 1：检查环境

- 验证 `$ZSXQ_TOKEN` 已设置
- 读取 `{baseDir}/groups.json`（星球配置）
- 确定目标日期（今天、昨天或用户指定的日期）

#### 步骤 2：抓取帖子

对 groups.json 中每个星球，按配置执行：

```bash
node {baseDir}/fetch_topics.js topics <group_id> <max_topics> <scope>
```

如果有多个星球，依次抓取，间隔 1.5 秒。

#### 步骤 3：解析文档附件（PDF 和 DOCX）

扫描步骤 2 获得的帖子，收集所有 `pdf_files`和`docx_files`。
对每个 PDF：

```bash
node {baseDir}/fetch_topics.js download-pdf <file_id>
```

PDF 之间间隔 1 秒。如果某个 PDF 解析失败，记录错误但继续处理其他 PDF。

对每个docx：

```bash
node {baseDir}/fetch_topics.js download-docx <file_id>
```

**步骤 2 和步骤 3 必须顺序执行**（步骤 3 依赖步骤 2 的 pdf_files 和 docx_files 结果）。

#### 步骤 4：汇总分析

结合帖子内容和 PDF/docx 文本，按下方报告格式输出。

---

## 报告输出格式

严格按以下六段式结构输出：

**针对大规模数据（100+帖子，30+文档）的特殊说明**：
- 每个章节控制在合理长度，避免信息过载
- 优先展示高频提及的内容
- 相似观点合并去重
- 在报告开头标注数据规模和处理进度

---

```
# 数据概览

- 处理日期：YYYY-MM-DD
- 帖子总数：XXX 条
- 文档总数：XXX 个（PDF: XX, DOCX: XX）
- 处理进度：已处理 XXX/XXX 帖子，XXX/XXX 文档
- 处理时长：XX 分钟
- 关键统计：
  - 最高频板块：XXX（提及 XX 次）
  - 最高频标的：XXX（提及 XX 次）
  - 看多/看空比例：XX% / XX%

---

# 一、帖子观点摘要

**展示策略**：
- 相似观点合并（如多个帖子都看好某板块，合并为一条）
- 按重要性排序，最多展示50条核心观点

按星球分组，每个星球包含：

- **星球名称**（标签来自 groups.json 的 note 字段）
- 每条帖子提炼 1-2 句核心投资观点
- 标注帖子提及的具体**股票代码**或**板块方向**
- 如有文档附件，标注 `📎 附件: xxx.pdf` 或 `📎 附件: xxx.docx`
- 互动数据（阅读/点赞/评论）

# 二、文档附件研报精华提炼

**展示策略**：
- 按券商权威性和内容相关性排序
- 优先展示重点券商研报（中信、国泰、华泰、招商、中金等）
- 相似研报合并（如多份研报都看好同一板块，提取共识观点）
- 最多展示20-30份核心研报
- 其余研报在"其他研报概览"中简要列出

对每个成功解析的文档附件（PDF、DOCX 等）：

- **文件名**（含券商名称）
- 3-5 个关键结论或数据要点
- 核心投资逻辑
- 提及的重点标的
- 目标价/评级（如有）

**其他研报概览**（当研报>50份时）：
- 按板块分类统计
- 列出研报标题和券商
- 标注看多/看空倾向

如果没有文档附件或全部解析失败，标注"本批次无文档附件"或"文档均为扫描件/无法提取文本"。

# 三、重点标的追踪（苹果 & 特斯拉）

**专门汇总苹果（Apple/AAPL）和特斯拉（Tesla/TSLA）相关内容**：

## 苹果（Apple/AAPL）
- 提及苹果的帖子数量和来源星球
- 核心观点汇总（看多/看空/中性）
- 关键数据和事件
- 相关研报要点（如有）
- 投资建议总结

## 特斯拉（Tesla/TSLA）
- 提及特斯拉的帖子数量和来源星球
- 核心观点汇总（看多/看空/中性）
- 关键数据和事件
- 相关研报要点（如有）
- 投资建议总结

**识别规则**：
- 关键词匹配：苹果、Apple、AAPL、特斯拉、Tesla、TSLA、马斯克、Musk
- 从帖子正文、文档附件、标的列表中提取
- 如果本批次没有相关内容，标注"本批次无苹果/特斯拉相关内容"

# 四、市场主题与趋势分析

跨帖子的综合分析：

- 共同市场主题和热点方向
- 板块热度排序
- 多空分歧点
- 市场情绪判断

# 五、投资参考建议

基于以上分析：

- 共识性看好的机会
- 需要关注的风险点
- 值得跟踪的标的列表
- 可能的操作思路（仅供参考）

# 六、免责声明

> 以上内容由 AI 基于知识星球公开信息自动生成，版权归原作者所有，不构成任何投资建议。投资有风险，决策需谨慎。

---
```

## 错误处理

| 错误场景 | 检测方式 | 处理 |
|---------|---------|------|
| Token 未设置 | `$ZSXQ_TOKEN` 为空 | 提示用户设置并说明获取方法 |
| pdf-parse 未安装 | node 报 MODULE_NOT_FOUND | 提示运行 `bash {baseDir}/install.sh` |
| Token 过期 | HTTP 401 | 提示重新获取 token |
| 未加入星球 | HTTP 403 | 提示用户需先加入该星球 |
| API 限流 | HTTP 429 | 自动重试（指数退避 2s/4s/8s） |
| 分页请求失败 | API 返回 succeeded=false | 自动重试最多3次（间隔2秒） |
| PDF 下载失败 | 下载返回非 200 | 自动重试最多3次（指数退避），失败后跳过该 PDF |
| PDF 为扫描件 | pdf-parse 返回空文本 | 报告中标注"扫描件，无法提取文本" |
| 星球不存在 | API 返回 succeeded=false | 跳过该星球，报告中标注 |
| 附件下载失败 | export-md 中部分附件失败 | 记录在 failures 数组，继续处理其他附件 |
| 目标日期无帖子 | export-md 返回 topics_count=0 | 提示用户该日期没有帖子 |
| 处理超时 | 超过30分钟 | 输出已处理部分的报告，标注进度 |
**原则：部分失败不中断整体流程。** PDF 解析失败仍输出帖子摘要，单个星球失败仍处理其他星球，部分附件下载失败仍生成报告。

---

## 详细 API 参考

如需了解 API 完整参数、响应结构、错误码等，参阅 `{baseDir}/references/api-reference.md`。
