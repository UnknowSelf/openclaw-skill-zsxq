---
name: zsxq-summary
description: 知识星球内容抓取、文档附件下载、PDF/DOCX 解析、按日期汇总分析。用户提到知识星球、按日期汇总、下载指定日期文档附件、解析已下载 PDF/DOCX、或需要单独筛选苹果/特斯拉相关内容时使用。支持完整分析流程（export-md -> parse-doc -> filter_focus_topics -> 生成报告并写入 report/MM-DD.md）和仅下载文档流程（export-doc）。
user-invocable: true
metadata:
  requires: node (>= 18), pdf-parse (^1.1.1), mammoth (^1.12.0)
  primaryEnv: ZSXQ_TOKEN
  version: 2.3.0
---

# 知识星球内容处理

所有输出使用中文。

## 必要检查

- `export-md`、`export-doc`、`groups` 需要 `ZSXQ_TOKEN`
- `parse-doc` 不需要 `ZSXQ_TOKEN`
- 如果未显式提供 `group_id`，需要读取 `{baseDir}/groups.json`
- 所有相对日期先转换为 `YYYY-MM-DD`

未设置 `ZSXQ_TOKEN` 时提示：

> 请先设置知识星球 Token：`export ZSXQ_TOKEN="your_token"`
> 获取方式：浏览器打开 wx.zsxq.com → 登录 → F12 → Application → Cookies → 复制 `zsxq_access_token` 的值。

## 命令选择

- 用户要“汇总 / 分析 / 生成报告 / 看某天星球内容”：
  使用完整分析流程：`export-md` -> `parse-doc` -> `filter_focus_topics` -> 生成报告 -> 写入 `report/MM-DD.md`
- 用户只要“下载某天文档附件 / 不需要帖子正文 / 不需要报告”：
  使用 `export-doc`
- 用户要“解析已经下载好的 PDF/DOCX”：
  使用 `parse-doc`
- 用户不知道 `group_id` 或想看已加入星球：
  使用 `groups`

不要在“仅下载文档附件”场景下走 `export-md` 重流程。

## 快速命令

```bash
# 按日期导出帖子 + 下载附件
node {baseDir}/fetch_topics.js export-md <group_id> <YYYY-MM-DD> [scope] [output_dir]

# 仅下载指定日期的文档附件
node {baseDir}/fetch_topics.js export-doc <YYYY-MM-DD> [scope] [output_dir]
node {baseDir}/fetch_topics.js export-doc <group_id> <YYYY-MM-DD> [scope] [output_dir]

# 解析指定目录下的 PDF / DOCX
node {baseDir}/fetch_topics.js parse-doc <doc_dir> [output_dir]

# 筛选苹果 / 特斯拉相关内容
node {baseDir}/filter_focus_topics.js <txtimg.md> <doc.md> [output_dir]
```

## 日期规则

统一转换为绝对日期：

- 今天 -> 当前日期
- 昨天 -> 当前日期减 1 天
- 前天 -> 当前日期减 2 天
- `3月1日` -> 当前年份 `-03-01`
- 已经是 `YYYY-MM-DD` 时直接使用

## 完整分析流程

### 1. 准备

- 验证 `ZSXQ_TOKEN`
- 解析目标日期
- 将目标日期同步转换为报告文件名 `MM-DD.md`
- 确保 `{baseDir}/report` 目录存在；不存在时先创建
- 读取 `{baseDir}/groups.json` 配置文件
- 对每个星球使用其配置的 `group_id` 和 `scope`

`groups.json` 结构示例：

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

关键约束：
- 如果环境变量 ZSXQ_TOKEN 未设置 或 {baseDir}/groups.json 配置文件读取失败则报错，不再继续执行

### 2. 导出帖子与附件

对 groups.json 配置文件中每个星球，执行：

```bash
node {baseDir}/fetch_topics.js export-md <group_id> <YYYY-MM-DD> <scope> {baseDir}/archive
```

关键约束：

- 必须等待命令返回完整 JSON，再读取任何输出文件
- 不要看到部分日志就提前判定完成
- 多个星球顺序执行，间隔 2 秒

读取 `export-md` 的 stdout JSON，使用其中返回的：

- `txtimg_file`
- `attachment_file`
- `attachments_dir`
- `failed_count`
- `failures`

不要硬编码猜测输出路径。

### 3. 读取帖子正文

读取 `txtimg_file` 用于观点提取。

注意：

- `attachment_file` 仅作记录，通常不需要参与总结

### 4. 解析文档附件

执行：

```bash
node {baseDir}/fetch_topics.js parse-doc <attachments_dir> {baseDir}/archive
```

关键约束：

- 读取 `parse-doc` 返回 JSON 里的 `output_file`
- 不要假设输出文件一定是 `MM-DD-doc.md`
- 当前实现按**执行当天日期**命名 `doc.md`，不是按源目录日期命名

同时使用返回 JSON 里的：

- `output_file`
- `total_files`
- `parsed_count`
- `skipped_count`
- `failed_count`
- `stats`

### 5. 筛选苹果 / 特斯拉

执行：

```bash
node {baseDir}/filter_focus_topics.js <txtimg_file> <doc_output_file> {baseDir}/archive
```

读取输出：

- `MM-DD-apple.md`
- `MM-DD-apple-weak.md`
- `MM-DD-tesla.md`
- `MM-DD-tesla-weak.md`
- `MM-DD-focus-summary.json`

使用规则：

- 苹果 / 特斯拉专项结论只允许来自强相关文件
- 弱相关文件只作背景补充
- 如果强相关文件只有“本批次无XXX强相关内容”，就必须明确写“本批次无XXX强相关内容”

### 6. 生成报告

报告结构固定为：

1. 数据概览
2. 帖子观点摘要
3. 文档附件研报精华提炼
4. 重点标的追踪（苹果 & 特斯拉）
5. 市场主题与趋势分析
6. 投资参考建议
7. 免责声明

报告要求：

- 先给“数据概览”，再进入正文各章节
- 优先合并重复观点，避免罗列原文
- 明确区分“帖子观点”与“文档研报观点”
- 苹果 / 特斯拉章节只对强相关内容下结论
- 若文档为空或全部解析失败，明确写“本批次无文档附件”或“文档均为扫描件/无法提取文本”
- 使用绝对日期，不用模糊相对时间

数据概览至少包含：

- 处理日期：`YYYY-MM-DD`
- 帖子总数
- 文档总数（区分 PDF / DOCX）
- 处理进度
- 处理时长
- 关键统计：
  - 最高频板块
  - 最高频标的
  - 看多 / 看空比例

各章节输出约束：

- 帖子观点摘要：
  - 合并相似观点
  - 按重要性排序
  - 最多展示 50 条核心观点
  - 标注帖子提及的具体**股票代码**或**板块方向**
- 文档附件研报精华提炼：
  - 按券商权威性和内容相关性排序
  - 优先展示重点券商研报（中信、国泰、华泰、招商、中金等）
  - 相似研报合并（如多份研报都看好同一板块，提取共识观点）
  - 最多展示20-30份核心研报
  - 其余研报在"其他研报概览"中简要列出
- 重点标的追踪（苹果 / 特斯拉）：
  - 提及苹果/特斯拉的帖子数量和来源星球
  - 核心观点汇总（看多/看空/中性）
  - 关键数据和事件
  - 相关研报要点（如有）
  - 投资建议总结
- 市场主题与趋势分析：
  - 总结帖子和文档附件共同市场主题和热点方向
  - 板块热度排序
  - 多空分歧点
  - 市场情绪判断
- 投资参考建议：
  - 共识性看好的机会
  - 需要关注的风险点
  - 值得跟踪的标的列表
  - 可能的操作思路（仅供参考）
- 免责声明：
  - 保留投资风险免责声明，不省略

大规模数据时额外要求：

- 每个章节控制长度，避免信息过载
- 优先展示高频提及内容
- 相似观点和相似研报去重合并

### 7. 写入报告文件

- 将最终完整报告写入 `{baseDir}/report/MM-DD.md`
- `MM-DD` 必须来自目标分析日期，不要使用 `parse-doc` 的输出文件名反推
- 同一天重复执行时，默认覆盖同名报告，保持结果最新
- 写入完成后，向用户返回：
  - 报告摘要
  - 报告绝对路径
  - 若存在附件下载或解析失败，补充说明失败数量与影响范围

## 仅下载文档流程

用户只要求下载文档附件时，使用 `export-doc`：

```bash
node {baseDir}/fetch_topics.js export-doc <YYYY-MM-DD> [scope] [output_dir]
node {baseDir}/fetch_topics.js export-doc <group_id> <YYYY-MM-DD> [scope] [output_dir]
```

执行规则：

- 只传日期时，从 `{baseDir}/groups.json` 读取目标星球并逐个下载
- 显式传 `group_id` 时只处理该星球
- 只下载 `topic.files` 中的非音频附件
- 不下载图片
- 自动跳过 `.mp3` / `.m4a` / `.wav`

读取 stdout JSON 中的：

- `group_id` / `group_ids`
- `scopes`
- `attachments_dir`
- `document_topics_count`
- `document_files_count`
- `files_downloaded`
- `skipped_audio_count`
- `failed_count`
- `failures`

## 错误处理

- `ZSXQ_TOKEN` 缺失：提示设置 token
- `401`：提示 token 失效
- `403`：提示未加入该星球
- `429`：允许自动指数退避重试
- `succeeded=false`：允许分页重试最多 3 次
- 部分附件下载失败：继续整体流程，并在结果中反映 `failed_count` / `failures`
- `parse-doc` 解析失败：继续整体流程，并在报告中说明文档不完整

统一超时口径：

- 导出类命令最多等待 20 分钟
- 超时后进入后续步骤，并明确写“导出超时，部分数据可能不完整”

## 输出与日志

- 所有错误和警告会写入 `{baseDir}/log/YYYYMMDD.log`
- 完整分析流程生成的最终报告写入 `{baseDir}/report/MM-DD.md`
- 需要精确路径时，优先使用命令返回 JSON，而不是手工拼路径

## 参考

- CLI 使用细节：`{baseDir}/README.md`
- 导出命令细节：`{baseDir}/README.md`
- API 参数与响应：`{baseDir}/references/api-reference.md`
