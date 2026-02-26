# zsxq-summary

知识星球内容抓取与投资分析 — [OpenClaw](https://github.com/nicepkg/openclaw) Skill

自动抓取知识星球帖子、解析 PDF 附件（研报等），由 AI 生成汇总摘要和投资参考建议。

## 功能特性

- 抓取指定星球的最新帖子（支持全部 / 仅精华）
- 自动下载并解析 PDF 附件，提取研报关键内容
- AI 生成五段式投资分析报告（观点摘要 → 研报提炼 → 趋势分析 → 投资建议 → 免责声明）
- 支持多星球配置
- 内置限速与指数退避重试

## 安装

### 作为 OpenClaw Skill 安装

```bash
openclaw skill install openclaw-zsxq-summary
```

### 手动安装

```bash
# 克隆到 skills 目录
git clone https://github.com/xiaobaibaoxiaojimao/openclaw-zsxq-summary.git \
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

> 帮我汇总一下知识星球最新的内容

Skill 会自动执行：抓取帖子 → 解析 PDF → 生成分析报告。

## 子命令参考

`fetch_topics.js` 提供以下子命令，可独立使用：

```bash
# 获取帖子（scope: all | digests）
node fetch_topics.js topics <group_id> [count] [scope]

# 获取精华帖（快捷方式）
node fetch_topics.js digests <group_id> [count]

# 下载并解析 PDF 附件
node fetch_topics.js download-pdf <file_id>

# 列出已加入的星球
node fetch_topics.js groups
```

## 报告格式

生成的报告包含五个部分：

1. **帖子观点摘要** — 按星球分组，提炼核心投资观点
2. **PDF 研报精华提炼** — 关键结论、数据要点、重点标的
3. **市场主题与趋势分析** — 热点方向、板块热度、多空分歧
4. **投资参考建议** — 共识机会、风险点、跟踪标的
5. **免责声明**

## 依赖

- Node.js >= 18
- [pdf-parse](https://www.npmjs.com/package/pdf-parse) — PDF 文本提取

## License

[MIT](LICENSE)
