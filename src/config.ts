import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMarketplaceId, MARKETPLACES, type MarketplaceId } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 项目根目录：无论 dev（tsx src/…）还是 prod（node dist/…）都指向仓库根。 */
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * 极简 .env 解析（KEY=VALUE），避免引入 dotenv 依赖。
 * 支持 # 注释、双/单引号包裹的值。
 */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!m) continue;
    const key = m[1]!;
    let value = m[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** AGENTS.md 硬约束：相邻 Attempt ≥ 2 秒。 */
export const MIN_REQUEST_INTERVAL_MS = 2000;
/** AGENTS.md 硬约束：并发 Attempt ≤ 2。 */
export const MAX_CONCURRENT_ATTEMPTS = 2;

export interface AppConfig {
  readonly port: number;
  readonly headless: boolean;
  readonly chromePath: string | null;
  readonly defaultMarketplace: MarketplaceId;
  readonly requestIntervalMs: number;
  readonly maxConcurrentAttempts: number;
  /** Phase 3：详情页 Attempt 最小间隔（毫秒）。默认 5000，硬下限 2000。见 ADR-0004。 */
  readonly detailIntervalMs: number;
  /** Phase 4：SQLite 数据库文件路径。默认 data/scraper.sqlite。 */
  readonly dbPath: string;
  /** Phase 4：是否启用定时调度器。默认 true。 */
  readonly schedulerEnabled: boolean;
  readonly publicDir: string;
  readonly projectRoot: string;
}

export interface LoadConfigOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly envFilePath?: string;
}

/**
 * 加载应用配置。优先级：process.env > .env 文件 > 默认值。
 * requestIntervalMs / maxConcurrentAttempts 会被 AGENTS.md 的硬约束夹紧。
 */
export function loadConfig(opts: LoadConfigOptions = {}): AppConfig {
  const env = opts.env ?? process.env;
  const envFilePath = opts.envFilePath ?? path.join(PROJECT_ROOT, '.env');
  const fileEnv = fs.existsSync(envFilePath)
    ? parseEnvFile(fs.readFileSync(envFilePath, 'utf8'))
    : {};
  const read = (key: string): string | undefined => {
    const v = env[key];
    if (v !== undefined && v !== '') return v;
    return fileEnv[key];
  };

  const portRaw = Number.parseInt(read('PORT') ?? '3456', 10);
  const port = Number.isFinite(portRaw) ? portRaw : 3456;

  const headless = (read('HEADLESS') ?? 'true').toLowerCase() !== 'false';

  const chromePathRaw = read('CHROME_PATH')?.trim();
  const chromePath = chromePathRaw && chromePathRaw.length > 0 ? chromePathRaw : null;

  const marketplaceRaw = read('DEFAULT_MARKETPLACE') ?? 'com';
  if (!isMarketplaceId(marketplaceRaw)) {
    const supported = Object.keys(MARKETPLACES).join(', ');
    throw new Error(`Unsupported DEFAULT_MARKETPLACE: ${marketplaceRaw} (supported: ${supported})`);
  }

  const intervalRaw = Number.parseInt(read('REQUEST_INTERVAL_MS') ?? '2000', 10);
  const concurrencyRaw = Number.parseInt(read('MAX_CONCURRENT_ATTEMPTS') ?? '1', 10);
  const detailIntervalRaw = Number.parseInt(read('DETAIL_INTERVAL_MS') ?? '5000', 10);

  return {
    port,
    headless,
    chromePath,
    defaultMarketplace: marketplaceRaw,
    requestIntervalMs: Math.max(
      MIN_REQUEST_INTERVAL_MS,
      Number.isFinite(intervalRaw) ? intervalRaw : MIN_REQUEST_INTERVAL_MS
    ),
    maxConcurrentAttempts: Math.min(
      MAX_CONCURRENT_ATTEMPTS,
      Math.max(1, Number.isFinite(concurrencyRaw) ? concurrencyRaw : 1)
    ),
    detailIntervalMs: Math.max(
      MIN_REQUEST_INTERVAL_MS,
      Number.isFinite(detailIntervalRaw) ? detailIntervalRaw : 5000
    ),
    dbPath: read('DB_PATH')?.trim() || path.join(PROJECT_ROOT, 'data', 'scraper.sqlite'),
    schedulerEnabled: (read('SCHEDULER_ENABLED') ?? 'true').toLowerCase() !== 'false',
    publicDir: path.join(PROJECT_ROOT, 'public'),
    projectRoot: PROJECT_ROOT,
  };
}
