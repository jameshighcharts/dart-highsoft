import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_BASELINE = '0055_game_sessions';
const DEFAULT_LEGACY_MANIFEST = 'supabase/migrations/legacy-numbered-migrations.txt';
const DEFAULT_MIGRATIONS_DIR = 'supabase/migrations';
const TIMESTAMPED_NAME = /^\d{14}_[a-z0-9_]+$/;

export function migrationName(file) {
  return path.basename(file, '.sql');
}

export function validateMigrationFiles({ files, legacyNames, baseline }) {
  const names = new Set(files.map(migrationName));
  if (!names.has(baseline)) {
    throw new Error(`Exact migration baseline ${baseline}.sql is missing`);
  }

  for (const legacyName of legacyNames) {
    if (!names.has(legacyName)) {
      throw new Error(`Legacy migration ${legacyName}.sql was removed or renamed`);
    }
  }

  const timestampVersions = new Set();
  for (const name of names) {
    if (legacyNames.has(name)) continue;
    if (!TIMESTAMPED_NAME.test(name)) {
      throw new Error(
        `New migration ${name}.sql must use a unique UTC timestamp name such as 20260904123000_description.sql`
      );
    }
    const version = name.slice(0, 14);
    if (timestampVersions.has(version)) {
      throw new Error(`Migration timestamp ${version} is used more than once`);
    }
    timestampVersions.add(version);
  }
}

export function selectPendingMigrations({ files, legacyNames, baseline, history }) {
  validateMigrationFiles({ files, legacyNames, baseline });
  const appliedNames = new Set(
    history.map((entry) => String(entry.name ?? '')).filter(Boolean)
  );

  return files
    .filter((file) => migrationName(file) > baseline)
    .filter((file) => !appliedNames.has(migrationName(file)))
    .sort();
}

async function loadRepositoryState({ root, baseline }) {
  const migrationsDir = path.join(root, DEFAULT_MIGRATIONS_DIR);
  const manifestPath = path.join(root, DEFAULT_LEGACY_MANIFEST);
  const [directoryEntries, manifest] = await Promise.all([
    readdir(migrationsDir),
    readFile(manifestPath, 'utf8'),
  ]);
  const files = directoryEntries.filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
  const legacyNames = new Set(
    manifest
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
  );
  validateMigrationFiles({ files, legacyNames, baseline });
  return { files, legacyNames, migrationsDir };
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function managementClient() {
  const token = requiredEnvironment('SUPABASE_ACCESS_TOKEN');
  const projectId = requiredEnvironment('SUPABASE_PROJECT_ID');
  const projectEndpoint = `https://api.supabase.com/v1/projects/${projectId}`;

  return async function request(pathname, options = {}) {
    const response = await fetch(`${projectEndpoint}${pathname}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase Management API failed (${response.status}): ${body}`);
    }
    return response.status === 204 ? null : response.json();
  };
}

async function migrationHistory(request) {
  const history = await request('/database/migrations');
  if (!Array.isArray(history)) throw new Error('Supabase returned invalid migration history');
  return history;
}

async function pendingMigrations({ request, repository, baseline }) {
  const history = await migrationHistory(request);
  return selectPendingMigrations({
    files: repository.files,
    legacyNames: repository.legacyNames,
    baseline,
    history,
  });
}

async function deploy({ root, baseline }) {
  const request = managementClient();
  const repository = await loadRepositoryState({ root, baseline });
  const pending = await pendingMigrations({ request, repository, baseline });

  for (const file of pending) {
    const name = migrationName(file);
    const query = await readFile(path.join(repository.migrationsDir, file), 'utf8');
    await request('/database/migrations', {
      method: 'POST',
      body: JSON.stringify({ name, query }),
    });
    console.log(`Applied ${file}`);
  }

  console.log(
    pending.length === 0
      ? `No migrations newer than exact baseline ${baseline} are pending`
      : `Applied ${pending.length} migration(s)`
  );
}

async function verify({ root, baseline, waitMs }) {
  const request = managementClient();
  const repository = await loadRepositoryState({ root, baseline });
  const deadline = Date.now() + waitMs;
  let pending = await pendingMigrations({ request, repository, baseline });

  while (pending.length > 0 && Date.now() < deadline) {
    console.log(`Waiting for migration history: ${pending.join(', ')}`);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    pending = await pendingMigrations({ request, repository, baseline });
  }
  if (pending.length > 0) {
    throw new Error(`Production is missing migrations: ${pending.join(', ')}`);
  }

  console.log('Production migration history is complete');
}

function parseWaitMs(args) {
  const inline = args.find((arg) => arg.startsWith('--wait-ms='));
  const separateIndex = args.indexOf('--wait-ms');
  const raw = inline?.slice('--wait-ms='.length)
    ?? (separateIndex >= 0 ? args[separateIndex + 1] : '0');
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 600_000) {
    throw new Error('--wait-ms must be an integer between 0 and 600000');
  }
  return value;
}

async function main() {
  const [command = 'validate', ...args] = process.argv.slice(2);
  const root = process.cwd();
  const baseline = process.env.SUPABASE_MIGRATION_BASELINE?.trim() || DEFAULT_BASELINE;

  if (command === 'validate') {
    await loadRepositoryState({ root, baseline });
    console.log('Supabase migration filenames are valid');
    return;
  }
  if (command === 'deploy') {
    await deploy({ root, baseline });
    return;
  }
  if (command === 'verify') {
    await verify({ root, baseline, waitMs: parseWaitMs(args) });
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
