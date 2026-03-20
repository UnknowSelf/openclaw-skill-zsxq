# zsxq-summary

知识星球内容抓取与投资分析 — OpenClaw Skill

自动抓取知识星球帖子、解析文档附件（PDF、DOCX 研报等），由 AI 生成汇总摘要和投资参考建议。

## 功能特性

- 抓取指定星球的最新帖子（支持全部 / 仅精华）
- 自动下载并解析文档附件（PDF、DOCX），提取研报关键内容
- **智能筛选与分批汇总**，优先展示高价值内容
- AI 生成六段式投资分析报告（观点摘要 → 研报提炼 → 重点标的追踪 → 趋势分析 → 投资建议 → 免责声明）
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

**优势**：
- 所有附件自动下载到本地，无需担心链接过期
- 支持离线查阅
- 附件按日期归档在 `archive/asset/MM-DD/`
- 每100个帖子自动分文件，便于管理

## 子命令参考

`fetch_topics.js` 提供以下子命令，可独立使用：

```bash
# 导出帖子到 Markdown，并下载附件（按日期导出）
node fetch_topics.js export-md <group_id> <YYYY-MM-DD> [scope] [output_dir]

# 解析文档文件（PDF 和 DOCX）
node fetch_topics.js parse-doc <doc_dir> [output_dir]

# 列出已加入的星球
node fetch_topics.js groups
```

### 导出 Markdown 说明

`export-md` 命令支持按日期导出，并具有以下特性：

**导出模式**：
- **按日期导出**：导出指定日期的所有帖子

**特性**：
- 自动分离图文帖子和附件帖子到不同文件
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
- 详细使用说明请参考 [EXPORT_USAGE.md](EXPORT_USAGE.md)

### 解析文档文件说明

`parse-doc` 命令用于解析指定目录下的所有 PDF 和 DOCX 文件，提取文本内容并保存到 Markdown 文件。

**命令格式**：

```bash
node fetch_topics.js parse-doc <doc_dir> [output_dir]
```

**参数说明**：
- `doc_dir`: 文档文件所在目录（支持递归扫描子目录）
- `output_dir`: 输出目录，默认 `archive`

**特性**：
- 递归扫描目录下所有 PDF 和 DOCX 文件
- 自动跳过图片型文档（文本长度 < 50 字符）
- 以文件名为标题，不同文档之间用 `---` 分隔
- 输出文件名：`MM-DD-doc.md`
- 分别统计 PDF 和 DOCX 的解析情况

**使用示例**：

```bash
# 解析 archive/asset/03-15 目录下的所有 PDF 和 DOCX
node fetch_topics.js parse-doc archive/asset/03-15

# 指定输出目录
node fetch_topics.js parse-doc archive/asset/03-15 output
```

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

生成的报告包含六个部分：

1. **帖子观点摘要** — 按星球分组，提炼核心投资观点
2. **文档附件研报精华提炼** — 关键结论、数据要点、重点标的
3. **重点标的追踪（苹果 & 特斯拉）** — 专门汇总苹果和特斯拉相关内容
4. **市场主题与趋势分析** — 热点方向、板块热度、多空分歧
5. **投资参考建议** — 共识机会、风险点、跟踪标的
6. **免责声明**

## 依赖

- Node.js >= 18
- [pdf-parse](https://www.npmjs.com/package/pdf-parse) — PDF 文本提取
- [mammoth](https://www.npmjs.com/package/mammoth) — DOCX 文本提取

## License

[MIT](LICENSE)
