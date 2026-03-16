---
name: zsxq-summary
description: 知识星球内容汇总与投资分析 — 自动抓取星球帖子 + 解析文档附件（PDF/DOCX），给出汇总摘要和投资参考建议
user-invocable: true
metadata:
  requires: node (>= 18), pdf-parse (^2.4.5), mammoth (^1.12.0)
  primaryEnv: ZSXQ_TOKEN
  version: 2.0.0
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

### 日志系统

**新增功能**：所有日志自动输出到 `{baseDir}/log/` 目录下的日期文件中。

- 日志文件格式：`YYYYMMDD.log`（例如：`20260314.log`）
- 日志级别：INFO、WARN、ERROR
- 自动创建日志目录和文件
- 同时输出到 stderr 和日志文件

**日志示例**：
```
[2026-03-14T10:30:00.000Z] [INFO] fetching digests topics for group 123...
[2026-03-14T10:30:05.000Z] [ERROR] fetch error: timeout
```

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

**依赖版本**：
- `pdf-parse`: ^2.4.5（最新版本，提升 PDF 解析能力）
- `mammoth`: ^1.12.0（最新版本，提升 DOCX 解析能力）

---

## 配置文件

### `{baseDir}/groups.json` — 星球配置

```json
[
  {
    "group_id": "YOUR_GROUP_ID",
    "name": "星球名称",
    "note": "投资分析",
    "scope": "digests"
  }
]
```

- `group_id`: 从星球 URL `wx.zsxq.com/group/{group_id}` 获取
- `scope`: `digests`（仅精华）| `all`（全部），推荐 `digests`
- `note`: 标签，用于报告中标注星球侧重方向

---

## 数据抓取脚本

`{baseDir}/fetch_topics.js` 提供三个核心子命令：

### 1. 导出帖子到 Markdown（按日期导出）

```bash
node {baseDir}/fetch_topics.js export-md <group_id> <YYYY-MM-DD> [scope] [output_dir]
```

支持按日期导出，自动下载所有附件（PDF、DOCX、图片、音频等）到本地。

- **按日期导出**：`export-md <group_id> 2026-03-01 all` - 导出指定日期的所有帖子
- scope: `all`（全部）| `digests`（精华），默认 `all`
- output_dir: 输出目录，默认 `{baseDir}/archive`

**特性**：
- 自动分离图文帖子和附件帖子到不同文件
- 附件按日期分目录存储在 `archive/asset/MM-DD/`
- 支持最多3次重试机制（分页请求和下载请求）
- 流式处理：边获取边下载边写入，防止URL过期

**输出文件**：
- 图文帖子：`archive/MM-DD-txtimg.md`（只包含文本和图片的帖子）
- 附件帖子：`archive/MM-DD-attachment.md`（包含文档附件的帖子）
- 附件目录：`archive/asset/MM-DD/`

**输出格式（stdout）：**
```json
{
  "group_id": "51122188845424",
  "scope": "all",
  "export_mode": "date (2026-03-01)",
  "txtimg_count": 120,
  "attachment_count": 30,
  "total_count": 150,
  "txtimg_file": "/path/to/archive/03-01-txtimg.md",
  "attachment_file": "/path/to/archive/03-01-attachment.md",
  "output_dir": "/path/to/archive",
  "attachments_dir": "/path/to/archive/asset/03-01",
  "files_downloaded": 45,
  "images_downloaded": 120,
  "failed_count": 3,
  "failures": [...]
}
```

### 2. 解析文档文件（PDF 和 DOCX）

```bash
node {baseDir}/fetch_topics.js parse-doc <doc_dir> [output_dir]
```

解析指定目录下的所有 PDF 和 DOCX 文件，提取文本内容并保存到 Markdown 文件。

- doc_dir: 文档文件所在目录（支持递归扫描子目录）
- output_dir: 输出目录，默认 `{baseDir}/archive`

**特性**：
- 递归扫描目录下所有 PDF 和 DOCX 文件
- 自动跳过图片型文档（文本长度 < 50 字符）
- 以文件名为标题，不同文档之间用 `---` 分隔
- 输出文件名：`MM-DD-doc.md`
- 分别统计 PDF 和 DOCX 的解析情况

**输出格式（stdout）：**
```json
{
  "source_dir": "/path/to/doc/dir",
  "output_file": "/path/to/archive/03-15-doc.md",
  "total_files": 34,
  "parsed_count": 34,
  "skipped_count": 0,
  "failed_count": 0,
  "stats": {
    "pdf": {
      "total": 2,
      "parsed": 2,
      "skipped": 0,
      "failed": 0
    },
    "docx": {
      "total": 32,
      "parsed": 32,
      "skipped": 0,
      "failed": 0
    }
  },
  "failures": []
}
```

**使用示例**：
```bash
# 解析 archive/asset/03-15 目录下的所有 PDF 和 DOCX
node {baseDir}/fetch_topics.js parse-doc archive/asset/03-15

# 指定输出目录
node {baseDir}/fetch_topics.js parse-doc archive/asset/03-15 output
```

### 3. 列出已加入的星球

```bash
node {baseDir}/fetch_topics.js groups
```

返回当前账号已加入的所有星球信息。

---

## 执行流程

### 日期解析规则

当用户使用相对日期时，需要转换为 YYYY-MM-DD 格式：

- "今天" → 当前日期（如 2026-03-14）
- "昨天" → 当前日期减1天（如 2026-03-13）
- "前天" → 当前日期减2天（如 2026-03-12）
- "3月1日" → 当前年份-03-01（如 2026-03-01）
- "2026-03-01" → 直接使用

**重要**：始终使用 YYYY-MM-DD 格式调用 export-md 命令。

### 按日期导出模式

#### 步骤 1：检查环境

- 验证 `$ZSXQ_TOKEN` 已设置
- 读取 `{baseDir}/groups.json`（星球配置）
- 确定目标日期（今天、昨天或用户指定的日期）

#### 步骤 2：导出帖子和附件

对 groups.json 中每个星球，执行：

```bash
node {baseDir}/fetch_topics.js export-md <group_id> <YYYY-MM-DD> <scope> {baseDir}/archive
```

例如导出今天（2026-03-15）的内容：
```bash
node {baseDir}/fetch_topics.js export-md 51122188845424 2026-03-15 all {baseDir}/archive
```

**输出**：
- 图文帖子文件：`{baseDir}/archive/03-15-txtimg.md`（只包含文本和图片的帖子，用于分析）
- 附件帖子文件：`{baseDir}/archive/03-15-attachment.md`（包含文档附件的帖子，仅作记录）
- 附件目录：`{baseDir}/archive/asset/03-15/`（包含所有 PDF、DOCX、图片等附件）

**文件分类说明**：
- 图文帖子（txtimg）：只包含文本和图片，没有文档附件，用于提取核心观点
- 附件帖子（attachment）：包含 PDF、DOCX 等文档附件的帖子，仅作记录（文档内容通过 parse-doc 命令单独解析）

如果有多个星球，依次导出，间隔 2 秒。

**⚠️ 关键执行规则（必须严格遵守）**：

1. **等待命令完成**：必须等待 export-md 命令完全执行完成后，才能进入步骤3
   - ❌ 禁止：命令还在运行时就开始读取文件
   - ❌ 禁止：看到部分输出就认为完成了
   - ✅ 正确：等待命令返回完整的 JSON 结果

2. **超时处理**：
   - 命令超时时间：20分钟
   - 如果20分钟后命令仍未完成：终止进程，进入步骤3，并在报告中说明"导出超时，部分数据可能不完整"
   - ❌ 禁止：提前主动终止（如5分钟、10分钟就终止）

3. **进度判断**：
   - 只有看到完整的 JSON 输出（包含 total_count、files_downloaded 等字段），才算完成
   - 如果只看到日志输出（如 "fetching page 1..."），说明还在进行中，必须继续等待

#### 步骤 3：读取导出的 Markdown 文件

读取步骤 2 生成的图文帖子文件：

```bash
# 读取图文帖子文件（用于分析）
cat {baseDir}/archive/03-15-txtimg.md
```

**说明**：
- 图文帖子文件（txtimg.md）：包含所有文本和图片内容，用于提取核心观点
- 附件帖子文件（attachment.md）：仅作记录，不需要读取（后续直接读取解析后的文档内容）

Markdown 文件已包含：
- 帖子完整内容（已优化格式，防止 Markdown 误识别）
- 图片链接（相对路径，如 `asset/03-15/xxx.png`）
- 帖子元数据（时间、ID、类型等）

**格式优化说明**：
- 数字列表已转义（`1、` → `\1、`），防止被误识别为 Markdown 列表
- 分隔线已转义（`--` → `\--`），防止被误识别为标题下划线
- 每行末尾添加了两个空格，确保正确换行显示

#### 步骤 4：解析文档附件

**推荐方式：使用 parse-doc 命令**

使用 `parse-doc` 命令一次性解析所有文档：

```bash
node {baseDir}/fetch_topics.js parse-doc {baseDir}/archive/asset/03-15 {baseDir}/archive
```

**输出**：
- 文档解析结果文件：`{baseDir}/archive/03-15-doc.md`
- 包含所有 PDF 和 DOCX 的文本内容
- 以文件名为标题，不同文档之间用 `---` 分隔
- 自动跳过图片型文档（文本长度 < 50 字符）

**输出格式示例**：
```markdown
# 文档解析结果

- source_dir: /path/to/archive/asset/03-15
- parsed_at: 2026-03-15T09:36:52.777Z

---
## 报告1.pdf

- 文件类型: PDF
- 页数: 10
- 文件大小: 1024 KB
- 文本长度: 5000 字符

[文档内容...]

---
## 报告2.docx

- 文件类型: DOCX
- 文件大小: 256 KB
- 文本长度: 3000 字符

[文档内容...]

---
```

**命令输出（JSON）**：
```json
{
  "source_dir": "/path/to/archive/asset/03-15",
  "output_file": "/path/to/archive/03-15-doc.md",
  "total_files": 34,
  "parsed_count": 34,
  "skipped_count": 0,
  "failed_count": 0,
  "stats": {
    "pdf": {
      "total": 2,
      "parsed": 2,
      "skipped": 0,
      "failed": 0
    },
    "docx": {
      "total": 32,
      "parsed": 32,
      "skipped": 0,
      "failed": 0
    }
  },
  "failures": []
}
```

**读取解析结果**：
```bash
cat {baseDir}/archive/03-15-doc.md
```

**去重处理**：
- 检测相同或相似的研报标题
- 合并重复内容，只保留一份

#### 步骤 4.5：筛选重点标的内容（苹果 & 特斯拉）

**目的**：提前筛选出苹果和特斯拉相关内容，确保在最终报告中不会遗漏。

**执行方式**：使用 awk 命令提取完整的帖子或研报段落（以 `---` 为分隔符）。

```bash
# 筛选苹果相关内容（提取完整帖子）
awk 'BEGIN{RS="---"; ORS="---\n"} /苹果|Apple|AAPL/ {print}' {baseDir}/archive/03-15-txtimg.md > {baseDir}/archive/03-15-apple.md

# 如果没有找到任何内容，写入提示信息
if [ ! -s {baseDir}/archive/03-15-apple.md ]; then
  echo "本批次无苹果相关内容" > {baseDir}/archive/03-15-apple.md
fi

# 筛选苹果相关研报（提取完整研报）
awk 'BEGIN{RS="---"; ORS="---\n"} /苹果|Apple|AAPL/ {print}' {baseDir}/archive/03-15-doc.md >> {baseDir}/archive/03-15-apple.md 2>/dev/null || true

# 筛选特斯拉相关内容（提取完整帖子）
awk 'BEGIN{RS="---"; ORS="---\n"} /特斯拉|Tesla|TSLA|马斯克|Musk/ {print}' {baseDir}/archive/03-15-txtimg.md > {baseDir}/archive/03-15-tesla.md

# 如果没有找到任何内容，写入提示信息
if [ ! -s {baseDir}/archive/03-15-tesla.md ]; then
  echo "本批次无特斯拉相关内容" > {baseDir}/archive/03-15-tesla.md
fi

# 筛选特斯拉相关研报（提取完整研报）
awk 'BEGIN{RS="---"; ORS="---\n"} /特斯拉|Tesla|TSLA|马斯克|Musk/ {print}' {baseDir}/archive/03-15-doc.md >> {baseDir}/archive/03-15-tesla.md 2>/dev/null || true
```

**命令说明**：
- `RS="---"`：设置记录分隔符为 `---`，将文件按段落分割
- `ORS="---\n"`：输出时保留 `---` 分隔符
- `/关键词/`：匹配包含关键词的完整段落
- `{print}`：输出整个匹配的段落（完整的帖子或研报）

**输出文件**：
- `{baseDir}/archive/03-15-apple.md`：所有提及苹果的完整帖子和研报
- `{baseDir}/archive/03-15-tesla.md`：所有提及特斯拉的完整帖子和研报

**读取筛选结果**：
```bash
cat {baseDir}/archive/03-15-apple.md
cat {baseDir}/archive/03-15-tesla.md
```

**注意**：
- 如果文件只包含"本批次无XXX相关内容"，说明该批次确实没有相关内容
- 筛选结果包含完整的帖子或研报，不会截断内容
- 每个段落之间保留 `---` 分隔符，便于阅读

#### 步骤 5：汇总分析

结合以下内容进行汇总分析：
- **图文帖子内容**：`{baseDir}/archive/03-15-txtimg.md`（提取核心观点和投资建议）
- **文档解析结果**：`{baseDir}/archive/03-15-doc.md`（提取研报精华和数据要点）
- **苹果相关内容**：`{baseDir}/archive/03-15-apple.md`（专门用于"重点标的追踪"章节）
- **特斯拉相关内容**：`{baseDir}/archive/03-15-tesla.md`（专门用于"重点标的追踪"章节）

**注意**：
- 必须读取全文进行汇总
- 附件帖子文件（`03-15-attachment.md`）仅作记录，不需要读取
- 文档内容已通过 parse-doc 命令解析并保存在 `03-15-doc.md` 中
- 苹果和特斯拉内容已单独筛选到 `03-15-apple.md` 和 `03-15-tesla.md`

**按报告格式输出，重点关注**：
- 图文帖子中的核心观点和投资建议
- 文档附件中的研报精华和数据要点
- 苹果和特斯拉相关内容的专门汇总（使用步骤 4.5 筛选的文件）

---

## 报告输出格式

**针对大规模数据（100+帖子，30+文档）的特殊说明**：
- 每个章节控制在合理长度，避免信息过载
- 优先展示高频提及的内容
- 相似观点合并去重
- 在报告开头标注数据规模

**必须严格按照以下数据概览加六段式结构输出报告**：

### 数据概览

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

### 一、帖子观点摘要

**展示策略**：
- 相似观点合并（如多个帖子都看好某板块，合并为一条）
- 将帖子汇总后，按重要性排序，最多展示50条核心观点
- 标注帖子提及的具体**股票代码**或**板块方向**

### 二、文档附件研报精华提炼

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

### 三、重点标的追踪（苹果 & 特斯拉）

**数据来源**：使用步骤 4.5 生成的筛选文件
- 苹果内容：`{baseDir}/archive/03-15-apple.md`
- 特斯拉内容：`{baseDir}/archive/03-15-tesla.md`

**专门汇总苹果（Apple/AAPL）和特斯拉（Tesla/TSLA）相关内容**：

#### 苹果（Apple/AAPL）
- 提及苹果的帖子数量和来源星球
- 核心观点汇总（看多/看空/中性）
- 关键数据和事件
- 相关研报要点（如有）
- 投资建议总结

#### 特斯拉（Tesla/TSLA）
- 提及特斯拉的帖子数量和来源星球
- 核心观点汇总（看多/看空/中性）
- 关键数据和事件
- 相关研报要点（如有）
- 投资建议总结

**识别规则**：
- 关键词匹配：苹果、Apple、AAPL、特斯拉、Tesla、TSLA、马斯克、Musk
- 从步骤 4.5 筛选的专门文件中提取（`03-15-apple.md` 和 `03-15-tesla.md`）
- 如果筛选文件只包含"本批次无XXX相关内容"，则在报告中标注"本批次无苹果/特斯拉相关内容"

### 四、市场主题与趋势分析

跨帖子的综合分析：

- 共同市场主题和热点方向
- 板块热度排序
- 多空分歧点
- 市场情绪判断

### 五、投资参考建议

基于以上分析：

- 共识性看好的机会
- 需要关注的风险点
- 值得跟踪的标的列表
- 可能的操作思路（仅供参考）

### 六、免责声明

> 以上内容由 AI 基于知识星球公开信息自动生成，版权归原作者所有，不构成任何投资建议。投资有风险，决策需谨慎。

---

## 错误处理

| 错误场景 | 检测方式 | 处理 |
|---------|---------|------|
| Token 未设置 | `$ZSXQ_TOKEN` 为空 | 提示用户设置并说明获取方法 |
| pdf-parse/mammoth 未安装 | node 报 MODULE_NOT_FOUND | 提示运行 `bash {baseDir}/install.sh` |
| Token 过期 | HTTP 401 | 提示重新获取 token |
| 未加入星球 | HTTP 403 | 提示用户需先加入该星球 |
| API 限流 | HTTP 429 | 自动重试（指数退避 2s/4s/8s） |
| 分页请求失败 | API 返回 succeeded=false | 自动重试最多3次（间隔2秒） |
| 文档下载失败 | 下载返回非 200 | 自动重试最多3次（指数退避），失败后跳过该文档 |
| 文档为扫描件 | parse-doc 跳过文本长度 < 50 | 在 skipped_count 中统计，不影响其他文档 |
| 星球不存在 | API 返回 succeeded=false | 跳过该星球，报告中标注 |
| 附件下载失败 | export-md 中部分附件失败 | 记录在 failures 数组，继续处理其他附件 |
| 目标日期无帖子 | export-md 返回 total_count=0 | 提示用户该日期没有帖子 |
| 文档解析失败 | parse-doc 返回 failed_count > 0 | 记录在 failures 数组，继续处理其他文档 |
| 处理超时 | 超过30分钟 | 输出已处理部分的报告，标注进度 |

**原则：部分失败不中断整体流程。** 文档解析失败仍输出帖子摘要，单个星球失败仍处理其他星球，部分附件下载失败仍生成报告。

**日志记录**：所有错误和警告都会记录到 `{baseDir}/log/YYYYMMDD.log` 文件中，便于事后排查。

---

## 版本更新记录

### v2.1.0 (2026-03-15)

**新增功能**：
- ✨ parse-doc 命令：一次性解析所有 PDF 和 DOCX 文件
- ✨ 文件分类：自动分离图文帖子和附件帖子到不同文件
- ✨ Markdown 格式优化：防止数字列表、分隔线被误识别
- ✨ 硬换行支持：每行末尾添加两个空格，确保正确换行

**优化改进**：
- 🔧 输出文件命名：`MM-DD-txtimg.md`（图文）和 `MM-DD-attachment.md`（附件）
- 🔧 文档解析结果：统一输出到 `MM-DD-doc.md`
- 🔧 格式转义：数字列表（`1、` → `\1、`）、分隔线（`--` → `\--`）
- 🔧 统计信息：分别统计 PDF 和 DOCX 的解析情况

### v2.0.0 (2026-03-14)

**新增功能**：
- ✨ 日志系统：所有日志自动输出到 `log/YYYYMMDD.log` 文件
- ✨ 日志分级：INFO、WARN、ERROR 三个级别
- ✨ 自动创建日志目录和文件

**依赖更新**：
- ⬆️ pdf-parse: 1.1.1 → 2.4.5（提升 PDF 解析能力）
- ⬆️ mammoth: 1.6.0 → 1.12.0（提升 DOCX 解析能力）

**优化改进**：
- 🔧 所有日志统一使用日志函数（info/warn/error）
- 🔧 错误消息同时输出到 stderr 和日志文件
- 🔧 改进错误处理和重试机制

---

## 详细 API 参考

如需了解 API 完整参数、响应结构、错误码等，参阅 `{baseDir}/references/api-reference.md`。
