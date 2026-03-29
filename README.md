# zsxq-summary

知识星球内容抓取与投资分析 — OpenClaw Skill

自动抓取知识星球帖子、解析文档附件（PDF、DOCX 研报等），由 AI 生成汇总摘要和投资参考建议。

## 功能特性

- 抓取指定星球的最新帖子（支持全部 / 仅精华）
- 自动下载并解析文档附件（PDF、DOCX），提取研报关键内容
- **智能筛选与分批汇总**，优先展示高价值内容
- AI 生成完整投资分析报告（数据概览 → 观点摘要 → 研报提炼 → 重点标的追踪 → 趋势分析 → 投资建议 → 免责声明）
- 支持多星球配置
- 内置限速与指数退避重试
- 文件存在性检查，避免重复下载

## 安装

### 作为 OpenClaw Skill 安装

```bash
openclaw skill install openclaw-zsxq-summary
```

### 手动安装

```bash
# 克隆到 skills 目录
git clone https://github.com/UnknowSelf/openclaw-zsxq-summary.git \
  ~/.openclaw/skills/zsxq-summary

# 安装依赖
bash ~/.openclaw/skills/zsxq-summary/install.sh
```

## 配置

### 1. 设置 Token

获取方式：浏览器打开 [wx.zsxq.com](https://wx.zsxq.com) → 登录 → F12 → Application → Cookies → 复制 `zsxq_access_token` 的值。

将 Token 添加到 OpenClaw 环境变量（`~/.openclaw/.env`）：

```bash
ZSXQ_TOKEN=你的token值
```

### 2. 配置星球

编辑 `groups.json`：

```json
[
  {
    "group_id": "YOUR_GROUP_ID",
    "name": "你的星球名称",
    "note": "投资分析",
    "scope": "digests"
  }
]
```

| 字段 | 说明 |
|------|------|
| `group_id` | 从星球 URL `wx.zsxq.com/group/{group_id}` 获取 |
| `name` | 星球名称（用于报告展示） |
| `note` | 标签，标注星球侧重方向 |
| `scope` | `digests`（仅精华）或 `all`（全部），推荐 `digests` |

不确定 group_id？运行 `groups` 子命令查看已加入的星球：

```bash
ZSXQ_TOKEN=xxx node fetch_topics.js groups
```

## 使用

在 OpenClaw 中直接对话即可触发：

### 按日期汇总

> 帮我汇总今天知识星球的内容

> 分析一下昨天的帖子

> 看看3月1日的星球内容

Skill 会自动执行：
1. 使用 `export-md` 命令按日期导出帖子
2. 下载所有附件（PDF、图片、音频等）到本地
3. 解析 Markdown 文件和 PDF/DOCX 附件
4. 生成完整的分析报告
5. 将报告写入 `report/MM-DD.md`

如果用户只要求“下载某天文档附件”，则优先使用 `export-doc`，不走完整分析流程。

**优势**：
- 所有附件自动下载到本地，无需担心链接过期
- 支持离线查阅
- 默认会归档到 skill 目录下的 `archive/asset/MM-DD/`
- 图文帖子与文档附件帖子自动分离，便于后续分析

## 子命令参考

`fetch_topics.js` 提供以下子命令，可独立使用：

```bash
# 导出帖子到 Markdown，并下载附件（按日期导出）
node fetch_topics.js export-md <group_id> <YYYY-MM-DD> [scope] [output_dir]

# 只下载指定日期帖子中的文档附件
node fetch_topics.js export-doc <YYYY-MM-DD> [scope] [output_dir]
# 或显式指定 group_id
node fetch_topics.js export-doc <group_id> <YYYY-MM-DD> [scope] [output_dir]

# 解析文档文件（PDF 和 DOCX）
node fetch_topics.js parse-doc <doc_dir> [output_dir]

# 列出已加入的星球
node fetch_topics.js groups
```

### 重点标的筛选（苹果 & 特斯拉）

新增 `filter_focus_topics.js`，用于对图文帖子和文档解析结果做三档筛选（强相关 / 弱相关 / 丢弃）：

```bash
node filter_focus_topics.js <txtimg.md> <doc.md> [output_dir]
```

示例：

```bash
node filter_focus_topics.js archive/03-15-txtimg.md archive/03-15-doc.md archive
```

输出文件：
- `03-15-apple.md` / `03-15-apple-weak.md`
- `03-15-tesla.md` / `03-15-tesla-weak.md`
- `03-15-focus-summary.json`

### 导出 Markdown 说明

`export-md` 命令支持按日期导出，并具有以下特性：

**导出模式**：
- **按日期导出**：导出指定日期的所有帖子

**特性**：
- 自动分离图文帖子和附件帖子到不同文件
- 帖子正文完整写入 Markdown，不截断到前 2000 字符
- 附件按日期分目录存储在 `asset/MM-DD/`
- 支持最多3次重试机制（分页请求和下载请求）
- 流式处理：边获取边下载边写入，防止URL过期

**命令格式**：

```bash
node fetch_topics.js export-md <group_id> <YYYY-MM-DD> [scope] [output_dir]
```

**文件命名规则**：
- 图文帖子：`MM-DD-txtimg.md`（只包含文本和图片的帖子）
- 附件帖子：`MM-DD-attachment.md`（包含文档附件的帖子）
- 未传 `output_dir` 时，默认输出到 skill 目录下的 `archive/`

**目录结构**：

```
archive/
├── 03-14-txtimg.md                # 图文帖子
├── 03-14-attachment.md            # 附件帖子
└── asset/
    └── 03-14/                     # 按日期分目录
        ├── image_xxx.png
        ├── xxx.pdf
        └── ...
```

**使用示例**：

```bash
# 按日期导出：导出 2026-03-14 的所有帖子
ZSXQ_TOKEN=xxx node fetch_topics.js export-md 51122188845424 2026-03-14 all

# 导出精华帖
ZSXQ_TOKEN=xxx node fetch_topics.js export-md 51122188845424 2026-03-14 digests

# 自定义输出目录
ZSXQ_TOKEN=xxx node fetch_topics.js export-md 51122188845424 2026-03-14 all ./my-export
```

**重要说明**：
- 图文帖子和附件帖子分别独立计数
- 同一天的所有附件存储在同一个日期目录下
- 分页请求失败会自动重试最多3次（间隔2秒）
- 下载请求失败会自动重试最多3次（指数退避：2秒、4秒、8秒）
- 精确输出路径请以命令返回 JSON 中的 `txtimg_file`、`attachment_file`、`attachments_dir` 为准

### 导出文档附件说明

`export-doc` 命令用于只下载指定日期帖子中的文档附件，不生成帖子 Markdown，也不会下载图片。

**命令格式**：

```bash
node fetch_topics.js export-doc <YYYY-MM-DD> [scope] [output_dir]
node fetch_topics.js export-doc <group_id> <YYYY-MM-DD> [scope] [output_dir]
```

**输出目录**：
- 未传 `output_dir` 时，默认下载到 skill 目录下的 `archive/asset/MM-DD/`
- 会跳过音频文件（`.mp3` / `.m4a` / `.wav`）
- 只传日期时，会从 `groups.json` 读取目标星球并逐个下载
- 精确输出路径以命令返回 JSON 为准，不要手工猜测

**使用示例**：

```bash
# 按 groups.json 下载 2026-03-14 的全部文档附件
ZSXQ_TOKEN=xxx node fetch_topics.js export-doc 2026-03-14 all

# 显式指定某个 group_id
ZSXQ_TOKEN=xxx node fetch_topics.js export-doc 51122188845424 2026-03-14 digests
```

**输出格式**：

```json
{
  "group_ids": ["51122188845424"],
  "scopes": [{ "group_id": "51122188845424", "scope": "all" }],
  "export_mode": "date (2026-03-14)",
  "output_dir": "/path/to/archive",
  "attachments_dir": "/path/to/archive/asset/03-14",
  "document_topics_count": 12,
  "document_files_count": 34,
  "files_downloaded": 34,
  "skipped_audio_count": 2,
  "failed_count": 0,
  "failures": []
}
```

### 解析文档文件说明

`parse-doc` 命令用于解析指定目录下的所有 PDF 和 DOCX 文件，提取文本内容并保存到 Markdown 文件。

**命令格式**：

```bash
node fetch_topics.js parse-doc <doc_dir> [output_dir]
```

**参数说明**：
- `doc_dir`: 文档文件所在目录（支持递归扫描子目录）
- `output_dir`: 输出目录，默认 skill 目录下的 `archive`

**特性**：
- 递归扫描目录下所有 PDF 和 DOCX 文件
- 自动跳过图片型文档（文本长度 < 50 字符）
- 以文件名为标题，不同文档之间用 `---` 分隔
- 输出文件名为**执行命令当天日期**对应的 `MM-DD-doc.md`
- 分别统计 PDF 和 DOCX 的解析情况

**使用示例**：

```bash
# 解析 archive/asset/03-15 目录下的所有 PDF 和 DOCX
node fetch_topics.js parse-doc archive/asset/03-15

# 指定输出目录
node fetch_topics.js parse-doc archive/asset/03-15 output
```

**重要说明**：
- 请以命令返回 JSON 中的 `output_file` 为准读取解析结果
- 不要假设输出文件名一定与源目录日期一致

**输出格式**：

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

## 报告格式

完整分析报告建议按以下结构输出：

1. **数据概览** — 处理日期、帖子总数、文档总数、处理进度、处理时长、关键统计
2. **帖子观点摘要** — 合并相似观点后输出核心观点，最多展示 50 条
3. **文档附件研报精华提炼** — 优先展示高相关、高权威研报，最多展示 20-30 份核心研报
4. **重点标的追踪（苹果 & 特斯拉）** — 强相关内容形成结论，弱相关内容仅作背景补充
5. **市场主题与趋势分析** — 热点方向、板块热度、多空分歧、市场情绪
6. **投资参考建议** — 共识机会、风险点、跟踪标的、可能的操作思路
7. **免责声明**

报告生成约束：
- 优先合并重复观点和重复研报，不要机械罗列原文
- 明确区分“帖子观点”和“文档研报观点”
- 苹果 / 特斯拉章节只允许基于强相关内容给出明确结论
- 当文档很多时，应补一个“其他研报概览”
- 如果没有文档附件或全部解析失败，应明确写出“本批次无文档附件”或“文档均为扫描件/无法提取文本”

报告落盘约定：
- 完整分析流程的最终报告应写入 `report/MM-DD.md`
- `MM-DD` 取自用户请求的目标日期，而不是 `parse-doc` 执行当天的输出名
- 同一天重复执行时，覆盖同名报告以保留最新版本

## 依赖

- Node.js >= 18
- [pdf-parse](https://www.npmjs.com/package/pdf-parse) — PDF 文本提取
- [mammoth](https://www.npmjs.com/package/mammoth) — DOCX 文本提取

## License

[MIT](LICENSE)
