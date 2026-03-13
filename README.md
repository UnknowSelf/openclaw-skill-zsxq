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
    "scope": "digests",
    "max_topics": 20
  }
]
```

| 字段 | 说明 |
|------|------|
| `group_id` | 从星球 URL `wx.zsxq.com/group/{group_id}` 获取 |
| `name` | 星球名称（用于报告展示） |
| `note` | 标签，标注星球侧重方向 |
| `scope` | `digests`（仅精华）或 `all`（全部），推荐 `digests` |
| `max_topics` | 每个星球最多抓取帖子数 |

不确定 group_id？运行 `groups` 子命令查看已加入的星球：

```bash
ZSXQ_TOKEN=xxx node fetch_topics.js groups
```

## 使用

在 OpenClaw 中直接对话即可触发：

### 按日期汇总（推荐）

> 帮我汇总今天知识星球的内容

> 分析一下昨天的帖子

> 看看3月1日的星球内容

Skill 会自动执行：
1. 使用 `export-md` 命令按日期导出帖子
2. 下载所有附件（PDF、图片、音频等）到本地
3. 解析 Markdown 文件和 PDF 附件
4. 生成完整的分析报告

**优势**：
- 所有附件自动下载到本地，无需担心链接过期
- 支持离线查阅
- 附件按日期归档在 `archive/asset/MM-DD/`
- 每100个帖子自动分文件，便于管理

### 快速浏览最新内容

> 帮我汇总一下知识星球最新的内容

> 看看最近20条帖子

Skill 会自动执行：
1. 使用 API 快速抓取最新帖子
2. 在线解析 PDF 附件
3. 生成分析报告

**优势**：速度快，适合快速浏览

## 子命令参考

`fetch_topics.js` 提供以下子命令，可独立使用：

```bash
# 获取帖子（scope: all | digests）
node fetch_topics.js topics <group_id> [count] [scope]

# 获取精华帖（快捷方式）
node fetch_topics.js digests <group_id> [count]

# 下载并解析 PDF 附件
node fetch_topics.js download-pdf <file_id>

# 下载并解析 DOCX 附件
node fetch_topics.js download-docx <file_id>

# 导出帖子到 Markdown，并下载附件（支持按数量或按日期导出）
node fetch_topics.js export-md <group_id> <count|YYYY-MM-DD> [scope] [output_dir]

# 列出已加入的星球
node fetch_topics.js groups
```

### 导出 Markdown 说明

`export-md` 命令支持两种导出模式，并具有以下特性：

**导出模式**：
- **按数量导出**：导出指定数量的最新帖子
- **按日期导出**：导出指定日期的所有帖子

**新特性**：
- 每100个帖子（5页）自动生成一个新的MD文件
- 附件按日期分目录存储在 `asset/MM-DD/`
- 支持最多3次重试机制（分页请求和下载请求）
- 流式处理：边获取边下载边写入，防止URL过期

**命令格式**：

```bash
node fetch_topics.js export-md <group_id> <count|YYYY-MM-DD> [scope] [output_dir]
```

**文件命名规则**：
- 按数量导出：`MM-DD-HH-mm-ss-0x.md`（如 `03-01-14-30-45-01.md`）
- 按日期导出：`MM-DD-0x.md`（如 `03-01-01.md`）

**目录结构**：

```
archive/
├── 03-01-01.md                    # 第1个文件（1-100个帖子）
├── 03-01-02.md                    # 第2个文件（101-160个帖子）
└── asset/
    └── 03-01/                     # 按日期分目录
        ├── image_xxx.png
        ├── xxx.pdf
        └── ...
```

**使用示例**：

```bash
# 按数量导出：导出最新 30 条精华帖
ZSXQ_TOKEN=xxx node fetch_topics.js export-md 51122188845424 30 digests

# 按日期导出：导出 2026-03-01 的所有帖子
ZSXQ_TOKEN=xxx node fetch_topics.js export-md 51122188845424 2026-03-01 all

# 自定义输出目录
ZSXQ_TOKEN=xxx node fetch_topics.js export-md 51122188845424 150 all ./my-export
```

**重要说明**：
- 每100个帖子自动创建新文件，文件序号从 `01` 开始递增
- 同一天的所有附件存储在同一个日期目录下
- 分页请求失败会自动重试最多3次（间隔2秒）
- 下载请求失败会自动重试最多3次（指数退避：2秒、4秒、8秒）
- 详细使用说明请参考 [EXPORT_USAGE.md](EXPORT_USAGE.md)

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
