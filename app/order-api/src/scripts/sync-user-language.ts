/**
 * DONG BO `language` VE shared-user - buoc 4.1, chay MOT LAN truoc khi trend
 * va terminal doi cho doc `user.language` sang shared-user (buoc 4.2 tro di).
 *
 * Vi sao can:
 *   - truoc 04/09/2026 `PATCH {trend}/user/:slug/language` chi ghi cot cuc bo
 *     cua trend (progress/shared-user.md "Bo sung (2026-09-04)") => ai doi
 *     ngon ngu truoc ngay do co gia tri dung o trend_db, gia tri cu o
 *     shared-user;
 *   - nhan vien terminal nhap qua `POST /internal/users/import` khong mang
 *     `language` (ImportSharedUserRequest) => ben shared-user dang o mac dinh.
 * Doi cho doc ma chua bu thi ca nhom nay roi ve ngon ngu mac dinh, khong log
 * nao bao.
 *
 * ## Gia tri dung cua tung nguoi - theo owner_service cua hang shared-user
 *   - owner 'terminal' (nhan vien terminal) -> cot cuc bo cua terminal_db;
 *   - owner NULL / 'trend' (khach, nhan vien trend) -> cot cuc bo cua trend_db
 *     neu trend co hang lien ket; khong co thi giu gia tri cua shared-user.
 *     Khach co o ca hai service ma hai ben khac nhau: uu tien trend (phuong an
 *     chot 05/10/2026, progress/terminal-api.md "Nguon du lieu khach hang").
 * Chot xong thi ghi vao shared-user, roi lam moi ban cache cuc bo cua service
 * KHONG phai nguon (vd khach o terminal): cache do con duoc doc toi khi tung
 * cho doc doi nguon, va phep do cua buoc (TC-ST-003, TC-TS-150/151) la 0 hang
 * lech o ca hai DB.
 *
 * ## Dieu kien chay - dot A (progress/buoc-trien-khai-gd2-10.md, quy dinh 1)
 *   - migration shared-user `v4.0.0-01` (owner_service_column) da chay;
 *   - script backfill user cua terminal (`terminal`
 *     src/scripts/backfill-shared-user-ids.ts) da chay xong;
 *   - TAT ca ba service. Script coi cot cuc bo cua trend la gia tri moi nhat
 *     cua khach - dung khi khong ai doi ngon ngu o noi khac trong luc chay.
 *     Terminal dang song ma khach vua doi o terminal thi gia tri do bi ghi de
 *     bang ban cua trend;
 *   - dump ca ba DB truoc `--execute`.
 *
 * ## Cach chay (tu thu muc shared-user/app/order-api, doc `.env` o day)
 *
 *   # Mac dinh: DRY RUN - chi doc va in ke hoach, KHONG ghi gi ca.
 *   npx ts-node -r tsconfig-paths/register src/scripts/sync-user-language.ts \
 *     --trend-db=trend_db --terminal-db=terminal_db
 *
 *   # Ghi that: them --execute
 *
 * DB cua shared-user = DATABASE_NAME trong `.env` (doi bang --shared-db=...).
 * trend/terminal o may chu khac thi dat TREND_DATABASE_HOST|PORT|USERNAME|
 * PASSWORD va TERMINAL_DATABASE_*; thieu bien nao thi lay DATABASE_* tuong ung
 * cua shared-user.
 *
 * Idempotent: chay lai sau --execute => 0 thay doi. Lenh ghi vao shared-user
 * kem dieu kien gia tri da doc (`AND language_column = <cu>`); hang bi doi
 * giua luc doc va luc ghi => huy ca giao dich, khong ghi gi, chay lai.
 *
 * ## Ten cot (quy dinh 2)
 * `language_column` cua trend/terminal se doi ten `_deprecated_language_column`
 * o buoc 8.9 => do ten qua information_schema; gap ca hai ten hoac khong ten
 * nao thi dung. Khong doc qua entity.
 */
import { config as dotenvConfig } from 'dotenv';
import {
  Connection,
  createConnection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';
import { Logger } from '@nestjs/common';
import { UserLanguage } from '../user/user.constant';

dotenvConfig({ path: '.env' });

const logger = new Logger('SyncUserLanguage');

type Side = 'trend' | 'terminal';
const SIDES: Side[] = ['trend', 'terminal'];
const TERMINAL_OWNER = 'terminal';
const USER_TABLE = 'user_tbl';
const LINK_COLUMN = 'shared_user_id_column';
const LANGUAGE_COLUMN = 'language_column';
const LANGUAGES = new Set<string>(Object.values(UserLanguage));

interface Db {
  side: Side | 'shared';
  database: string;
  conn: Connection;
}

interface LocalSide {
  db: Db;
  languageColumn: string;
  // sharedUserId -> cac gia tri language cua (cac) hang lien ket
  languages: Map<string, Set<string>>;
}

interface SharedRow {
  id: string;
  language: string;
  owner: string | null;
}

interface SharedChange {
  id: string;
  from: string;
  to: string;
  source: Side;
}

interface CacheChange {
  side: Side;
  id: string;
  from: string[];
  to: string;
}

interface Plan {
  shared: SharedChange[];
  cache: CacheChange[];
  skipped: string[];
  orphans: Record<Side, number>;
}

const argValue = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  return process.argv
    .find((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length);
};

const requireArg = (name: string): string => {
  const value = argValue(name);
  if (!value) {
    throw new Error(`Thieu tham so --${name}=<ten DB>`);
  }
  return value;
};

const connect = async (side: Db['side'], database: string): Promise<Db> => {
  const prefix =
    side === 'shared' ? 'DATABASE_' : `${side.toUpperCase()}_DATABASE_`;
  const env = (key: string) =>
    process.env[`${prefix}${key}`] ?? process.env[`DATABASE_${key}`];
  const conn = await createConnection({
    host: env('HOST'),
    port: Number(env('PORT')),
    user: env('USERNAME'),
    password: env('PASSWORD'),
    database,
  });
  return { side, database, conn };
};

const findColumns = async (db: Db, names: string[]): Promise<string[]> => {
  const [rows] = await db.conn.query<RowDataPacket[]>(
    `SELECT column_name AS name FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ? AND column_name IN (?)`,
    [db.database, USER_TABLE, names],
  );
  return rows.map((row) => String(row.name));
};

const requireColumns = async (db: Db, names: string[]): Promise<void> => {
  const found = await findColumns(db, names);
  const missing = names.filter((name) => !found.includes(name));
  if (missing.length) {
    throw new Error(
      `${db.database}.${USER_TABLE} thieu cot ${missing.join(', ')}`,
    );
  }
};

// Cot dang mang ten `name` hoac `_deprecated_name` (quy dinh 2).
const resolveRenamedColumn = async (db: Db, name: string): Promise<string> => {
  const found = await findColumns(db, [name, `_deprecated_${name}`]);
  if (found.length !== 1) {
    throw new Error(
      `${db.database}.${USER_TABLE}: can dung MOT trong hai cot ${name} / ` +
        `_deprecated_${name}, thay ${found.length} (${found.join(', ')})`,
    );
  }
  return found[0];
};

const readLocal = async (db: Db): Promise<LocalSide> => {
  await requireColumns(db, [LINK_COLUMN]);
  const languageColumn = await resolveRenamedColumn(db, LANGUAGE_COLUMN);
  const [rows] = await db.conn.query<RowDataPacket[]>(
    `SELECT \`${LINK_COLUMN}\` AS id, \`${languageColumn}\` AS language
       FROM \`${USER_TABLE}\` WHERE \`${LINK_COLUMN}\` IS NOT NULL`,
  );
  const languages = new Map<string, Set<string>>();
  for (const row of rows) {
    const id = String(row.id);
    if (!languages.has(id)) languages.set(id, new Set());
    languages.get(id).add(String(row.language));
  }
  return { db, languageColumn, languages };
};

const readShared = async (db: Db): Promise<SharedRow[]> => {
  await requireColumns(db, [
    'id_column',
    LANGUAGE_COLUMN,
    'owner_service_column',
  ]);
  const [rows] = await db.conn.query<RowDataPacket[]>(
    `SELECT id_column AS id, language_column AS language,
            owner_service_column AS owner FROM \`${USER_TABLE}\``,
  );
  return rows.map((row) => ({
    id: String(row.id),
    language: String(row.language),
    owner: row.owner === null ? null : String(row.owner),
  }));
};

const buildPlan = (
  shared: SharedRow[],
  local: Record<Side, LocalSide>,
): Plan => {
  const plan: Plan = {
    shared: [],
    cache: [],
    skipped: [],
    orphans: { trend: 0, terminal: 0 },
  };

  for (const row of shared) {
    const source: Side = row.owner === TERMINAL_OWNER ? 'terminal' : 'trend';
    const sourceValues = local[source].languages.get(row.id);

    let target = row.language;
    if (sourceValues) {
      if (sourceValues.size > 1) {
        plan.skipped.push(
          `${row.id}: ${source} co nhieu hang lien ket voi language khac nhau (${[...sourceValues].join(', ')})`,
        );
        continue;
      }
      const [value] = [...sourceValues];
      if (!LANGUAGES.has(value)) {
        plan.skipped.push(
          `${row.id}: ${source} mang language khong hop le '${value}'`,
        );
        continue;
      }
      target = value;
    }

    if (target !== row.language) {
      plan.shared.push({ id: row.id, from: row.language, to: target, source });
    }

    for (const side of SIDES) {
      if (side === source && sourceValues) continue;
      const values = local[side].languages.get(row.id);
      if (!values) continue;
      const stale = [...values].filter((value) => value !== target);
      if (stale.length) {
        plan.cache.push({ side, id: row.id, from: stale, to: target });
      }
    }
  }

  const sharedIds = new Set(shared.map((row) => row.id));
  for (const side of SIDES) {
    for (const id of local[side].languages.keys()) {
      if (!sharedIds.has(id)) plan.orphans[side] += 1;
    }
  }
  return plan;
};

const printPlan = (plan: Plan): void => {
  for (const change of plan.shared) {
    logger.log(
      `  shared   ${change.id}  ${change.from} -> ${change.to}  (nguon ${change.source})`,
    );
  }
  for (const change of plan.cache) {
    logger.log(
      `  ${change.side.padEnd(8)} ${change.id}  ${change.from.join('/')} -> ${change.to}  (lam moi cache)`,
    );
  }
  for (const reason of plan.skipped) {
    logger.log(`  BO QUA   ${reason}`);
  }
  const fromTrend = plan.shared.filter((c) => c.source === 'trend').length;
  const fromTerminal = plan.shared.length - fromTrend;
  const cacheOf = (side: Side) =>
    plan.cache.filter((c) => c.side === side).length;
  logger.log(
    `Tong: shared-user ${plan.shared.length} hang (tu trend ${fromTrend}, ` +
      `tu terminal ${fromTerminal}) · cache trend ${cacheOf('trend')} · ` +
      `cache terminal ${cacheOf('terminal')} · bo qua ${plan.skipped.length} · ` +
      `hang lien ket khong co ben shared-user (vd hang retire cua terminal - khong dung toi) ` +
      `trend ${plan.orphans.trend} / terminal ${plan.orphans.terminal}`,
  );
};

const inTransaction = async (
  db: Db,
  work: () => Promise<void>,
): Promise<void> => {
  await db.conn.beginTransaction();
  try {
    await work();
    await db.conn.commit();
  } catch (error) {
    await db.conn.rollback();
    throw error;
  }
};

const execute = async (
  plan: Plan,
  sharedDb: Db,
  local: Record<Side, LocalSide>,
): Promise<void> => {
  // shared-user truoc: cache chi la ban sao, hong giua chung thi chay lai la
  // tinh lai dung phan con thieu.
  await inTransaction(sharedDb, async () => {
    for (const change of plan.shared) {
      const [result] = await sharedDb.conn.execute<ResultSetHeader>(
        `UPDATE \`${USER_TABLE}\` SET language_column = ?
          WHERE id_column = ? AND language_column = ?`,
        [change.to, change.id, change.from],
      );
      if (result.affectedRows !== 1) {
        throw new Error(
          `shared-user ${change.id} da doi giua luc doc va luc ghi ` +
            `(affectedRows=${result.affectedRows}) - huy, khong ghi gi; tat service roi chay lai`,
        );
      }
    }
  });

  for (const side of SIDES) {
    const changes = plan.cache.filter((change) => change.side === side);
    if (!changes.length) continue;
    const { db, languageColumn } = local[side];
    await inTransaction(db, async () => {
      for (const change of changes) {
        await db.conn.execute(
          `UPDATE \`${USER_TABLE}\` SET \`${languageColumn}\` = ?
            WHERE \`${LINK_COLUMN}\` = ? AND \`${languageColumn}\` <> ?`,
          [change.to, change.id, change.to],
        );
      }
    });
  }
};

const main = async (): Promise<void> => {
  const shouldExecute = process.argv.includes('--execute');
  const sharedName = argValue('shared-db') ?? process.env.DATABASE_NAME;
  if (!sharedName)
    throw new Error('Thieu DATABASE_NAME trong .env hoac --shared-db=');
  const names: Record<Side, string> = {
    trend: requireArg('trend-db'),
    terminal: requireArg('terminal-db'),
  };

  const dbs: Db[] = [];
  try {
    const sharedDb = await connect('shared', sharedName);
    dbs.push(sharedDb);
    const local = {} as Record<Side, LocalSide>;
    for (const side of SIDES) {
      const db = await connect(side, names[side]);
      dbs.push(db);
      local[side] = await readLocal(db);
    }
    const shared = await readShared(sharedDb);

    logger.log(
      `${shouldExecute ? 'GHI THAT' : 'DRY RUN'} - shared-user ${sharedName} ` +
        `(${shared.length} hang) · trend ${names.trend}.${local.trend.languageColumn} ` +
        `· terminal ${names.terminal}.${local.terminal.languageColumn}`,
    );
    const plan = buildPlan(shared, local);
    printPlan(plan);

    if (!shouldExecute) {
      logger.log('DRY RUN - khong ghi gi. Them --execute de ghi that.');
      return;
    }
    if (!plan.shared.length && !plan.cache.length) {
      logger.log('Khong co gi de ghi.');
      return;
    }

    await execute(plan, sharedDb, local);

    // Doi chieu lai tu DB, khong tin vao ke hoach.
    for (const side of SIDES) local[side] = await readLocal(local[side].db);
    const after = buildPlan(await readShared(sharedDb), local);
    logger.log(
      `Doi chieu sau khi ghi: con ${after.shared.length + after.cache.length} ` +
        `hang lech (mong doi 0), bo qua ${after.skipped.length}`,
    );
    if (after.shared.length || after.cache.length) process.exitCode = 1;
  } finally {
    await Promise.all(dbs.map((db) => db.conn.end()));
  }
};

main().catch((error) => {
  logger.error(`LOI: ${error.message}`);
  process.exit(1);
});
