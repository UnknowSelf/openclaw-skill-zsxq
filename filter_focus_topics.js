#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function usage() {
  console.error('Usage: node filter_focus_topics.js <txtimg.md> <doc.md> [output_dir]');
  process.exit(1);
}

const txtPathArg = process.argv[2];
const docPathArg = process.argv[3];
const outDirArg = process.argv[4];
if (!txtPathArg || !docPathArg) usage();

const txtPath = path.resolve(process.cwd(), txtPathArg);
const docPath = path.resolve(process.cwd(), docPathArg);
const outputDir = path.resolve(process.cwd(), outDirArg || path.dirname(txtPath));

if (!fs.existsSync(txtPath)) {
  console.error(JSON.stringify({ error: `txtimg file not found: ${txtPath}` }));
  process.exit(1);
}
if (!fs.existsSync(docPath)) {
  console.error(JSON.stringify({ error: `doc file not found: ${docPath}` }));
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

function splitRecords(text) {
  return text
    .split(/\n---\n/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function countMatches(text, patterns) {
  let total = 0;
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) total += matches.length;
  }
  return total;
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function parseTitle(record) {
  const m = record.match(/^##\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

function looksLikeNoise(record) {
  const noisePatterns = [
    /请阅读最后一页各项声明/,
    /免责申明/,
    /免责声明/,
    /图表目录/,
    /内容目录/,
    /风险提示/,
  ];
  let score = 0;
  for (const p of noisePatterns) {
    if (p.test(record)) score += 1;
  }
  return score >= 2;
}

function evaluateRecord(record, source, cfg) {
  const title = parseTitle(record);
  const head = record.slice(0, 600);
  const allKeywords = cfg.mainKeywords;
  const specificKeywords = cfg.specificKeywords;
  const contextKeywords = cfg.contextKeywords;

  const titleHits = countMatches(title, allKeywords);
  const headHits = countMatches(head, allKeywords);
  const totalHits = countMatches(record, allKeywords);
  const specificHits = countMatches(record, specificKeywords);
  const contextHits = countMatches(record, contextKeywords);
  const noise = looksLikeNoise(record);

  let score = 0;
  if (titleHits > 0) score += 5;
  if (headHits > 0) score += 3;
  score += Math.min(totalHits, 5);
  score += Math.min(specificHits * 2, 8);
  score += Math.min(contextHits, 3);
  if (noise) score -= 4;
  if (source === 'doc' && titleHits === 0 && totalHits <= 2 && specificHits === 0) score -= 2;

  let kind = 'discard';
  if (score >= 8) kind = 'strong';
  else if (score >= 4) kind = 'weak';

  if (totalHits === 0) kind = 'discard';
  if (source === 'doc' && noise && titleHits === 0 && specificHits === 0) kind = 'discard';

  return {
    source,
    title,
    score,
    kind,
    titleHits,
    headHits,
    totalHits,
    specificHits,
    contextHits,
    noise,
    record,
  };
}

const focusConfigs = {
  apple: {
    label: '苹果',
    emptyStrong: '本批次无苹果强相关内容',
    emptyWeak: '本批次无苹果弱相关内容',
    mainKeywords: [/苹果/gi, /\bApple\b/g, /\bAAPL\b/g],
    specificKeywords: [
      /iPhone/gi,
      /Mac\b/gi,
      /iPad/gi,
      /Vision\s*Pro/gi,
      /Apple\s*Intelligence/gi,
      /App\s*Store/gi,
      /果链/gi,
      /苹果产业链/gi,
      /苹果手机/gi,
    ],
    contextKeywords: [/智能手机/gi, /AI手机/gi, /消费电子/gi, /终端/gi, /出货/gi, /供应链/gi, /ASP/gi],
  },
  tesla: {
    label: '特斯拉',
    emptyStrong: '本批次无特斯拉强相关内容',
    emptyWeak: '本批次无特斯拉弱相关内容',
    mainKeywords: [/特斯拉/gi, /\bTesla\b/g, /\bTSLA\b/g, /马斯克/gi, /\bMusk\b/g],
    specificKeywords: [
      /Model\s*3/gi,
      /Model\s*Y/gi,
      /FSD/gi,
      /Robotaxi/gi,
      /Optimus/gi,
      /4680/gi,
      /上海工厂/gi,
      /柏林工厂/gi,
      /交付量/gi,
      /自动驾驶/gi,
    ],
    contextKeywords: [/新能源车/gi, /电动车/gi, /汽车/gi, /汽零/gi, /出海/gi, /毛利率/gi, /销量/gi],
  },
};

const txtRecords = splitRecords(fs.readFileSync(txtPath, 'utf8')).map((record) => ({ source: 'txt', record }));
const docRecords = splitRecords(fs.readFileSync(docPath, 'utf8')).map((record) => ({ source: 'doc', record }));
const allRecords = [...txtRecords, ...docRecords];

function fileStemFromTxtPath(p) {
  const base = path.basename(p, path.extname(p));
  return base.replace(/-txtimg$/, '');
}

const stem = fileStemFromTxtPath(txtPath);
const summary = {
  input: { txtPath, docPath, outputDir },
  generated_at: new Date().toISOString(),
  results: {},
};

for (const [key, cfg] of Object.entries(focusConfigs)) {
  const evaluated = allRecords.map(({ source, record }) => evaluateRecord(record, source, cfg));
  const strong = evaluated.filter((x) => x.kind === 'strong').sort((a, b) => b.score - a.score);
  const weak = evaluated.filter((x) => x.kind === 'weak').sort((a, b) => b.score - a.score);

  const strongPath = path.join(outputDir, `${stem}-${key}.md`);
  const weakPath = path.join(outputDir, `${stem}-${key}-weak.md`);

  const strongContent = strong.length
    ? strong.map((x) => x.record).join('\n\n---\n\n') + '\n'
    : `${cfg.emptyStrong}\n`;
  const weakContent = weak.length
    ? weak.map((x) => x.record).join('\n\n---\n\n') + '\n'
    : `${cfg.emptyWeak}\n`;

  fs.writeFileSync(strongPath, strongContent, 'utf8');
  fs.writeFileSync(weakPath, weakContent, 'utf8');

  summary.results[key] = {
    strong_count: strong.length,
    weak_count: weak.length,
    strong_file: strongPath,
    weak_file: weakPath,
    top_strong_titles: strong.slice(0, 5).map((x) => ({ title: x.title, score: x.score, source: x.source })),
    top_weak_titles: weak.slice(0, 5).map((x) => ({ title: x.title, score: x.score, source: x.source })),
  };
}

const summaryPath = path.join(outputDir, `${stem}-focus-summary.json`);
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
summary.summary_file = summaryPath;
console.log(JSON.stringify(summary, null, 2));
