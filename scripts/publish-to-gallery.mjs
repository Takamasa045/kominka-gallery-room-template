#!/usr/bin/env node
/**
 * みんなの古民家ギャラリー｜AI相棒向け 直接アップロード＆公開スクリプト（ゼロ依存）
 *
 * 使い方:
 *   node scripts/publish-to-gallery.mjs status [--json]
 *   node scripts/publish-to-gallery.mjs claim [--json]
 *   node scripts/publish-to-gallery.mjs upload <画像または動画ファイルパス> [--json]
 *   node scripts/publish-to-gallery.mjs publish [--recipe room-recipe.json] [--status published|draft] [--json]
 *
 * 認証情報:
 *   .env.local または環境変数から読み込みます（トークン本体は絶対に表示しません）
 *   - MUSUHI_GALLERY_TOKEN=mgk_...   （必須・互換名 GALLERY_AGENT_TOKEN も可）
 *   - MUSUHI_GALLERY_BASE_URL=https://lab.azumimusuhi.jp（任意・互換名 GALLERY_BASE_URL も可）
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASE_URL = 'https://lab.azumimusuhi.jp';
const TOKEN_PATTERN = /^mgk_[0-9a-f]{48}$/;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const VIDEO_MAX_BYTES = 15 * 1024 * 1024;
const RECIPE_MAX_BYTES = 32 * 1024;
const MAX_WORKS = 8;
const MAX_PROJECTS = 5;

const KANJI_WINGS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

const ALLOWED_MP4_MAJOR_BRANDS = new Set([
  'isom',
  'iso2',
  'iso3',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
  'M4A ',
  'qt  ',
  'dash',
  'msdh',
  'msix',
  '3gp4',
  '3gp5',
  '3gp6',
  'f4v ',
]);

const VALID_THEMES = new Set([
  'daybreak',
  'moss',
  'wind',
  'rain',
  'dusk',
  'cloud',
  'lake',
  'indigo',
  'moon',
]);

function redactSecrets(text) {
  return String(text ?? '').replace(/mgk_[0-9a-f]{6,}/gi, '[REDACTED_TOKEN]');
}

function fail(message, exitCode = 1) {
  process.stderr.write(`エラー: ${redactSecrets(message)}\n`);
  process.exit(exitCode);
}

function formatDoorLabel(room) {
  if (!room || typeof room.wing !== 'number' || typeof room.slot !== 'number') {
    return '未割り当て';
  }
  const kanji = KANJI_WINGS[room.wing - 1];
  const wingLabel = kanji ? `離れ ${kanji}の棟` : `離れ 第${room.wing}棟`;
  return `${wingLabel} ${room.slot}番の扉`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function parseEnvFile(filePath) {
  const vars = {};
  if (!fs.existsSync(filePath)) return vars;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eqIndex = normalized.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = normalized.slice(0, eqIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = normalized.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    } else {
      const commentIdx = value.indexOf(' #');
      if (commentIdx >= 0) value = value.slice(0, commentIdx).trim();
    }
    vars[key] = value;
  }
  return vars;
}

function loadConfig() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..');
  const candidateEnvPaths = [
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(repoRoot, '.env.local'),
  ];

  const fileVars = {};
  for (const envPath of candidateEnvPaths) {
    if (fs.existsSync(envPath)) {
      Object.assign(fileVars, parseEnvFile(envPath));
      break;
    }
  }

  const pick = (...keys) => {
    for (const key of keys) {
      const fromEnv = process.env[key]?.trim();
      if (fromEnv) return fromEnv;
      const fromFile = fileVars[key]?.trim();
      if (fromFile) return fromFile;
    }
    return '';
  };

  const token = pick('MUSUHI_GALLERY_TOKEN', 'GALLERY_AGENT_TOKEN');
  if (!token) {
    fail(
      'AI相棒用の鍵が見つかりません。このフォルダの `.env.local` に `MUSUHI_GALLERY_TOKEN=mgk_...` を設定してください（会員サイトの「お部屋を編集」→「GitHubで管理・練習」タブから発行できます）。',
    );
  }
  if (!TOKEN_PATTERN.test(token)) {
    fail(
      '設定されている鍵の形式が正しくないようです（`mgk_` で始まる52文字の鍵が必要です）。`.env.local` の `MUSUHI_GALLERY_TOKEN` を確認してください。',
    );
  }

  const rawBaseUrl = pick('MUSUHI_GALLERY_BASE_URL', 'GALLERY_BASE_URL') || DEFAULT_BASE_URL;
  let parsedUrl;
  try {
    parsedUrl = new URL(rawBaseUrl);
  } catch {
    fail('接続先URL（MUSUHI_GALLERY_BASE_URL）の形式が正しくありません。');
  }
  const isLocalHttp =
    parsedUrl.protocol === 'http:' &&
    (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1');
  if (parsedUrl.protocol !== 'https:' && !isLocalHttp) {
    fail('安全のため、接続先URL（MUSUHI_GALLERY_BASE_URL）は `https://` から始まるアドレスを指定してください。');
  }

  const baseUrl = rawBaseUrl.replace(/\/+$/, '');
  return { token, baseUrl };
}

function detectMediaType(bytes) {
  if (!bytes || bytes.byteLength < 3) return null;

  // PNG
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mediaKind: 'image', ext: 'png', contentType: 'image/png' };
  }

  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mediaKind: 'image', ext: 'jpg', contentType: 'image/jpeg' };
  }

  // WebP
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mediaKind: 'image', ext: 'webp', contentType: 'image/webp' };
  }

  // GIF
  if (
    bytes.byteLength >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return { mediaKind: 'image', ext: 'gif', contentType: 'image/gif' };
  }

  // MP4 (ISO BMFF ftyp box)
  if (
    bytes.byteLength >= 16 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    const majorBrand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (
      boxSize >= 16 &&
      boxSize <= Math.min(bytes.byteLength, 1024) &&
      boxSize % 4 === 0 &&
      ALLOWED_MP4_MAJOR_BRANDS.has(majorBrand)
    ) {
      return { mediaKind: 'video', ext: 'mp4', contentType: 'video/mp4' };
    }
  }

  // WebM / EBML
  if (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return { mediaKind: 'video', ext: 'webm', contentType: 'video/webm' };
  }

  return null;
}

async function apiRequest(config, method, endpointPath, options = {}) {
  const url = `${config.baseUrl}${endpointPath}`;
  const headers = {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/json',
    ...(options.headers ?? {}),
  };

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body,
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
  } catch (err) {
    const reason = err?.name === 'TimeoutError' ? '通信がタイムアウトしました' : 'サーバーに接続できませんでした';
    fail(`${reason}（接続先: ${config.baseUrl}）。ネット接続を確認してもう一度お試しください。`);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return { status: response.status, ok: response.ok, data };
}

function explainApiError(res, fallback) {
  const serverMessage =
    typeof res.data?.message === 'string'
      ? res.data.message
      : typeof res.data?.error === 'string'
        ? res.data.error
        : '';
  const field = typeof res.data?.field === 'string' ? `（項目: ${res.data.field}）` : '';

  if (res.status === 401) {
    return '認証に失敗しました。`.env.local` の `MUSUHI_GALLERY_TOKEN` が無効になっているか、作り直された可能性があります。会員サイトのギャラリー編集画面から鍵を確認してください。';
  }
  if (res.status === 403) {
    return serverMessage || '会員権限の確認に失敗しました。会員ステータスを確認してください。';
  }
  if (res.status === 413) {
    return serverMessage || 'ファイルまたはデータの容量が上限を超えています（画像5MB・短い動画15MB・レシピ32KBまで）。';
  }
  if (res.status === 429) {
    return serverMessage || 'アクセスが集中しています。少し時間をおいてからもう一度お試しください。';
  }
  if (res.status === 422 || res.status === 415) {
    return `${serverMessage || fallback}${field}`;
  }
  if (res.status >= 500) {
    return serverMessage || 'ギャラリーサーバーまたは保管庫が一時的に応答できませんでした。少し時間をおいてお試しください。';
  }
  return serverMessage || `${fallback}（HTTP ${res.status}）`;
}

function printRoomSummary(room, baseUrl) {
  if (!room) {
    console.log('まだ自分の展示室が割り当てられていません。');
    console.log('`node scripts/publish-to-gallery.mjs claim` または `publish` で自動確保できます。');
    return;
  }
  const works = Array.isArray(room.works) ? room.works : [];
  const projects = Array.isArray(room.curation?.projects) ? room.curation.projects : [];
  console.log(`扉: ${formatDoorLabel(room)} (ID: ${room.id})`);
  console.log(`部屋名: ${room.title}`);
  console.log(`作者名: ${room.author}`);
  console.log(`公開状態: ${room.status === 'published' ? 'みんなに公開中 (published)' : '下書き・本人のみ (draft)'}`);
  console.log(`雰囲気色: ${room.theme}`);
  console.log(`表示モード: ${room.renderMode === 'custom_bundle' ? '丸ごと特注アトリエ' : '古民家テンプレート'}`);
  console.log(`展示作品: ${works.length}点 / 開発中GitHub: ${projects.length}件`);
  for (const [idx, work] of works.entries()) {
    const mediaTag = [work.imageUrl ? '画像あり' : '', work.videoUrl ? '動画あり' : '']
      .filter(Boolean)
      .join('・');
    console.log(`  - [${idx + 1}] (${work.kind}) ${work.title}${mediaTag ? ` [${mediaTag}]` : ''}`);
  }
  for (const [idx, proj] of projects.entries()) {
    console.log(`  - [Project ${idx + 1}] ${proj.name} (${proj.stage}) -> ${proj.repoUrl}`);
  }
  if (room.updatedAt) {
    console.log(`最終更新: ${room.updatedAt}`);
  }
  console.log(`ギャラリーURL: ${baseUrl}/member/gallery/`);
}

function parseFlags(args) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') {
      flags.json = true;
    } else if (arg === '--recipe' && i + 1 < args.length) {
      flags.recipe = args[++i];
    } else if (arg.startsWith('--recipe=')) {
      flags.recipe = arg.slice('--recipe='.length);
    } else if (arg === '--status' && i + 1 < args.length) {
      flags.status = args[++i];
    } else if (arg.startsWith('--status=')) {
      flags.status = arg.slice('--status='.length);
    } else if (arg === '-h' || arg === '--help') {
      flags.help = true;
    } else if (arg.startsWith('--')) {
      fail(`未知のオプションです: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function printUsage() {
  console.log(`みんなの古民家ギャラリー 直接アップロード＆公開スクリプト

使い方:
  node scripts/publish-to-gallery.mjs status [--json]
      現在の自分の展示室の状態を確認します。

  node scripts/publish-to-gallery.mjs claim [--json]
      まだ自分の部屋がない場合に、空き扉を自動確保します。

  node scripts/publish-to-gallery.mjs upload <画像または動画ファイルパス> [--json]
      画像（PNG/JPEG/WebP/GIF・5MB以内）または短い動画（MP4/WebM・15MB以内）を
      会員専用保管庫へアップロードし、room-recipe.json に書ける /api/gallery/media/... を返します。

  node scripts/publish-to-gallery.mjs publish [--recipe room-recipe.json] [--status published|draft] [--json]
      お部屋レシピ（既定: room-recipe.json）を本番の自分の展示室へ直接反映します。
      まだ自分の部屋がない場合は自動で確保してから反映します。

必要な設定（.env.local）:
  MUSUHI_GALLERY_BASE_URL=https://lab.azumimusuhi.jp
  MUSUHI_GALLERY_TOKEN=mgk_...
  ※ .env.local は絶対に GitHub へコミット・push しないでください。`);
}

async function cmdStatus(config, flags) {
  const res = await apiRequest(config, 'GET', '/api/gallery/rooms');
  if (!res.ok || !res.data?.ok) {
    fail(explainApiError(res, 'お部屋情報の取得に失敗しました。'));
  }
  const myRoom = res.data.myRoom ?? null;
  if (flags.json) {
    console.log(JSON.stringify({ ok: true, myRoom }, null, 2));
    return;
  }
  printRoomSummary(myRoom, config.baseUrl);
}

async function cmdClaim(config, flags) {
  const res = await apiRequest(config, 'POST', '/api/gallery/me/claim');
  if (!res.ok || !res.data?.ok) {
    fail(explainApiError(res, '自分の部屋の確保に失敗しました。'));
  }
  const room = res.data.room ?? res.data.myRoom ?? null;
  if (flags.json) {
    console.log(JSON.stringify({ ok: true, created: Boolean(res.data.created), room }, null, 2));
    return;
  }
  console.log(res.data.created ? '新しい自分の展示室を確保しました！' : 'すでに確保済みの展示室があります。');
  printRoomSummary(room, config.baseUrl);
}

async function cmdUpload(config, positionals, flags) {
  const targetPath = positionals[0];
  if (!targetPath) {
    fail('アップロードする画像または動画ファイルのパスを指定してください。例: node scripts/publish-to-gallery.mjs upload ./photo.png');
  }
  const resolvedPath = path.resolve(process.cwd(), targetPath);
  if (!fs.existsSync(resolvedPath)) {
    fail(`ファイルが見つかりません: ${targetPath}`);
  }
  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) {
    fail(`通常のファイルを指定してください: ${targetPath}`);
  }
  if (stat.size === 0) {
    fail('空のファイルはアップロードできません。');
  }
  if (stat.size > VIDEO_MAX_BYTES) {
    fail(
      `ファイル容量が大きすぎます（${formatBytes(stat.size)}）。画像は 5 MB 以内、短い動画は 15 MB 以内にしてください（長い動画は YouTube リンクを works[].videoUrl に設定できます）。`,
    );
  }

  const buffer = fs.readFileSync(resolvedPath);
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const detected = detectMediaType(bytes);
  if (!detected) {
    fail(
      '対応していないファイル形式です。画像は PNG / JPEG / WebP / GIF（5MB以内）、短い動画は MP4 / WebM（15MB以内）のみアップロードできます（SVGやHTMLは非対応です）。',
    );
  }

  const maxBytes = detected.mediaKind === 'image' ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;
  if (bytes.byteLength > maxBytes) {
    fail(
      detected.mediaKind === 'image'
        ? `画像の容量が大きすぎます（${formatBytes(bytes.byteLength)}）。画像は 5 MB 以内にしてください。`
        : `動画の容量が大きすぎます（${formatBytes(bytes.byteLength)}）。短い動画は 15 MB 以内にしてください（長い動画は YouTube リンクをご利用ください）。`,
    );
  }

  const form = new FormData();
  const baseName = path.basename(resolvedPath).replace(/\.[^.]+$/, '') || 'media';
  const uploadFileName = `${baseName}.${detected.ext}`;
  form.append('file', new Blob([bytes], { type: detected.contentType }), uploadFileName);

  const res = await apiRequest(config, 'POST', '/api/gallery/media', {
    body: form,
    timeoutMs: 60_000,
  });
  if (!res.ok || !res.data?.ok) {
    fail(explainApiError(res, 'メディアのアップロードに失敗しました。'));
  }

  const result = {
    ok: true,
    mediaUrl: res.data.mediaUrl,
    mediaKind: res.data.mediaKind,
    contentType: res.data.contentType,
    byteLength: res.data.byteLength,
  };

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('アップロードが完了しました！');
  console.log(`種類: ${result.mediaKind === 'image' ? '画像' : '短い動画'} (${result.contentType} / ${formatBytes(result.byteLength)})`);
  console.log(`mediaUrl: ${result.mediaUrl}`);
  console.log(
    result.mediaKind === 'image'
      ? '→ room-recipe.json の works[].imageUrl にこのパスを設定してください。'
      : '→ room-recipe.json の works[].videoUrl にこのパスを設定してください。',
  );
}

function buildUpdatePayloadFromRecipe(recipePath, statusOverride) {
  const resolved = path.resolve(process.cwd(), recipePath);
  if (!fs.existsSync(resolved)) {
    fail(`レシピファイルが見つかりません: ${recipePath}`);
  }
  const rawText = fs.readFileSync(resolved, 'utf8');
  if (Buffer.byteLength(rawText, 'utf8') > RECIPE_MAX_BYTES) {
    fail('room-recipe.json のサイズが上限（32KB）を超えています。画像データなどを直接埋め込まず、upload コマンドで得たパスを設定してください。');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText.replace(/^\uFEFF/, ''));
  } catch {
    fail(`JSONの書き方に誤りがあります（${recipePath}）。記号やカンマを確認してください。`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('レシピファイルの形式が正しくありません（JSONオブジェクトである必要があります）。');
  }

  const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
  const author = typeof parsed.author === 'string' ? parsed.author.trim() : '';
  const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
  const theme = typeof parsed.theme === 'string' ? parsed.theme.trim() : '';
  const status = statusOverride ?? (typeof parsed.status === 'string' ? parsed.status.trim() : 'draft');

  if (!title || title.length > 60) {
    fail('部屋の名前（title）は 1〜60 文字で指定してください。');
  }
  if (!author || author.length > 40) {
    fail('作者名（author）は 1〜40 文字で指定してください。');
  }
  if (description.length > 300) {
    fail('お部屋のひとこと（description）は 300 文字以内で指定してください。');
  }
  if (!VALID_THEMES.has(theme)) {
    fail(`雰囲気色（theme）が許可値ではありません: ${theme || '(未指定)'}`);
  }
  if (status !== 'draft' && status !== 'published') {
    fail(`公開設定（status）は "draft" または "published" を指定してください（指定値: ${status}）。`);
  }

  const works = Array.isArray(parsed.works) ? parsed.works : [];
  if (works.length > MAX_WORKS) {
    fail(`作品（works）は最大 ${MAX_WORKS} 点までです（現在 ${works.length} 点）。`);
  }

  const curation = parsed.curation && typeof parsed.curation === 'object' && !Array.isArray(parsed.curation)
    ? parsed.curation
    : {};
  if (Array.isArray(curation.projects) && curation.projects.length > MAX_PROJECTS) {
    fail(`開発中プロジェクト（curation.projects）は最大 ${MAX_PROJECTS} 件までです（現在 ${curation.projects.length} 件）。`);
  }

  const payload = {
    title,
    author,
    description,
    theme,
    status,
    works,
    curation,
  };
  if (typeof parsed.githubRepoUrl === 'string' && parsed.githubRepoUrl.trim()) {
    payload.githubRepoUrl = parsed.githubRepoUrl.trim();
  }
  return payload;
}

async function cmdPublish(config, flags) {
  if (flags.status && flags.status !== 'draft' && flags.status !== 'published') {
    fail('--status には published または draft を指定してください。');
  }

  const recipePath = flags.recipe || 'room-recipe.json';
  const payload = buildUpdatePayloadFromRecipe(recipePath, flags.status);

  // 先に自分の部屋が存在するか確認し、未確保なら自動で確保する
  const listRes = await apiRequest(config, 'GET', '/api/gallery/rooms');
  if (!listRes.ok || !listRes.data?.ok) {
    fail(explainApiError(listRes, 'お部屋状態の確認に失敗しました。'));
  }

  let autoClaimed = false;
  if (!listRes.data.myRoom) {
    const claimRes = await apiRequest(config, 'POST', '/api/gallery/me/claim');
    if (!claimRes.ok || !claimRes.data?.ok) {
      fail(explainApiError(claimRes, '自分の展示室の自動確保に失敗しました。'));
    }
    autoClaimed = true;
  }

  const bodyJson = JSON.stringify(payload);
  let putRes = await apiRequest(config, 'PUT', '/api/gallery/me', {
    headers: { 'Content-Type': 'application/json' },
    body: bodyJson,
  });

  if (putRes.status === 404 && !autoClaimed) {
    const claimRes = await apiRequest(config, 'POST', '/api/gallery/me/claim');
    if (!claimRes.ok || !claimRes.data?.ok) {
      fail(explainApiError(claimRes, '自分の展示室の自動確保に失敗しました。'));
    }
    autoClaimed = true;
    putRes = await apiRequest(config, 'PUT', '/api/gallery/me', {
      headers: { 'Content-Type': 'application/json' },
      body: bodyJson,
    });
  }

  if (!putRes.ok || !putRes.data?.ok) {
    fail(explainApiError(putRes, '展示室の更新・公開に失敗しました。'));
  }

  const room = putRes.data.room ?? putRes.data.myRoom;
  if (flags.json) {
    console.log(JSON.stringify({ ok: true, autoClaimed, room }, null, 2));
    return;
  }

  if (autoClaimed) {
    console.log('自分の展示室を新しく確保し、レシピを反映しました！');
  } else {
    console.log(
      room?.status === 'published'
        ? '本番の展示室へ反映して公開しました！'
        : '本番の展示室へ下書きとして反映しました！',
    );
  }
  printRoomSummary(room, config.baseUrl);
}

async function main() {
  const [, , subcommand, ...rest] = process.argv;
  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printUsage();
    return;
  }

  const { positionals, flags } = parseFlags(rest);
  if (flags.help) {
    printUsage();
    return;
  }

  const config = loadConfig();

  switch (subcommand) {
    case 'status':
      await cmdStatus(config, flags);
      break;
    case 'claim':
      await cmdClaim(config, flags);
      break;
    case 'upload':
      await cmdUpload(config, positionals, flags);
      break;
    case 'publish':
      await cmdPublish(config, flags);
      break;
    default:
      fail(`未知のコマンドです: ${subcommand}（使えるコマンド: status / claim / upload / publish / help）`);
  }
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : '予期しないエラーが発生しました。');
});
