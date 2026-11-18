/**
 * WALLET BACKFILL trend -> shared-user. Step 6.12 rehearses it; it runs for
 * real in the wallet cutover window (step 7.4), once trend has stopped writing
 * its four wallet tables.
 *
 * It copies the wallet of every person from trend's database into
 * shared-user: balance_tbl, point_transaction_tbl, accumulated_point_tbl and
 * accumulated_point_transaction_history_tbl, plus the link
 * user_tbl.accumulated_point_column. On both sides that link sits on the user
 * row, so inserting a points row alone would leave data nobody can reach.
 *
 * ## Source (QD-T1)
 * trend's database only. The wallet terminal keeps in its own database is an
 * overlapping fork of the same data. It is not imported: adding it would
 * count twice, and "take the larger one" is wrong. terminal prints it for the
 * record with its own read-only report. Until the wallet cutover trend is the
 * only writer of a wallet, so a value that differs is a value trend changed
 * after the copy, and trend wins.
 *
 * ## Matching (by sharedUserId)
 * A person is user_tbl.shared_user_id_column on trend, which is
 * user_tbl.id_column on shared-user.
 *   - balance row and points row: one per person, matched by person.
 *     shared-user may hold its own row, under another id, for someone trend
 *     provisioned locally;
 *   - coin transactions and point history: matched by id_column, because the
 *     rows of the monolith copy share their ids. The user or the points row of
 *     a row is mapped to the person's row on shared-user.
 * Missing rows are inserted with their trend id. Rows with other values get
 * trend's values, updated_at included. Coin transactions without a key get
 * '<source>:legacy:<id>': the internal views of step 6.10 read "the whole
 * system of a service" by key prefix, and a row without a key belongs to no
 * service. Point history rows get object_* from trend's order, the way
 * migration v4.0.0-03 derived them from the copy ('ORDER', order id,
 * '<source>:<order slug>').
 *
 * ## Persons left alone (listed, exit code 1 on --execute)
 *   - shared-user already wrote to their wallet on its own: a coin
 *     transaction or a point history row trend does not have, or a balance or
 *     points row carrying an idempotency key. After the cutover shared-user is
 *     the source and trend's frozen copy is older, so overwriting would undo
 *     real transactions. This is what makes a late run safe;
 *   - trend holds more than one open reservation for them. The unique index of
 *     migration v4.0.0-05 allows one per points row and service, and the
 *     script will not choose which one to keep (rule 4 of 14/11/2026);
 *   - a conflict the script will not guess about: several trend users on one
 *     person, a trend id or slug already used by another row on shared-user,
 *     a history row whose order trend no longer has.
 * Wallet rows trend cannot tie to a person on shared-user are listed too.
 *
 * ## When to run (rule 1, release wave A)
 * After every migration of both services (on shared-user at least v4.0.0-03,
 * -04 and -05: object_*, idempotency keys, open reservation index), with the
 * services stopped: trend no longer writes its wallet, nobody writes to
 * shared-user's wallet. Dump both databases before --execute.
 *
 * ## How to run (from shared-user/app/order-api, reads .env here)
 *
 *   # Default: DRY RUN, reads both databases and prints the plan, writes nothing.
 *   npx ts-node -r tsconfig-paths/register src/scripts/backfill-wallet-from-trend.ts \
 *     --trend-db=trend_db
 *
 *   # Write: add --execute. --verbose prints every row it would write.
 *
 * shared-user's database is DATABASE_NAME of .env (or --shared-db=). trend on
 * another server: set TREND_DATABASE_HOST|PORT|USERNAME|PASSWORD, each one
 * falling back to DATABASE_*. trend is only read, inside a READ ONLY
 * transaction.
 *
 * Idempotent: a second run plans 0 writes. One transaction per person, and
 * every update carries the values it read: a row changed in between rolls the
 * person back and is reported. After --execute the plan is built again from
 * both databases; what is left is reported and expected to be 0. The last
 * line, SUMMARY {...}, holds the counts and the timings as JSON.
 *
 * ## Names (rule 2)
 * Step 8.9 renames trend's four wallet tables and
 * user_tbl.accumulated_point_column to _deprecated_*. Both names are looked up
 * in information_schema; finding both or neither stops the run. Nothing is
 * read through entities.
 */
import { config as dotenvConfig } from 'dotenv';
import {
  Connection,
  createConnection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';
import { Logger } from '@nestjs/common';

dotenvConfig({ path: '.env' });

const logger = new Logger('BackfillWalletFromTrend');

const SOURCE_SERVICE = 'trend';
const legacyKeyOf = (id: string): string => `${SOURCE_SERVICE}:legacy:${id}`;
const objectSlugOf = (orderSlug: string): string =>
  `${SOURCE_SERVICE}:${orderSlug}`;
const ORDER_OBJECT_TYPE = 'ORDER';

const USER_TABLE = 'user_tbl';
const ORDER_TABLE = 'order_tbl';
const POINTS_LINK = 'accumulated_point_column';
const KEY = 'external_transaction_id_column';

type Value = string | null;
type Row = Record<string, Value>;

interface TableSpec {
  name: string;
  // Columns copied from trend as they are.
  copied: string[];
  // Columns that tell whether an existing row already holds trend's values.
  compared: string[];
}

const BASE = [
  'id_column',
  'slug_column',
  'created_at_column',
  'updated_at_column',
  'deleted_at_column',
  'created_by_column',
];

const BALANCE: TableSpec = {
  name: 'balance_tbl',
  copied: [...BASE, 'points_column'],
  compared: ['points_column', 'deleted_at_column'],
};

const POINTS: TableSpec = {
  name: 'accumulated_point_tbl',
  copied: [...BASE, 'total_points_column'],
  compared: ['total_points_column', 'deleted_at_column'],
};

const TRANSACTIONS: TableSpec = {
  name: 'point_transaction_tbl',
  copied: [
    ...BASE,
    'type_column',
    'desc_column',
    'object_id_column',
    'object_type_column',
    'object_slug_column',
    'points_column',
    'balance_column',
  ],
  compared: [
    'created_at_column',
    'deleted_at_column',
    'type_column',
    'desc_column',
    'object_id_column',
    'object_type_column',
    'object_slug_column',
    'points_column',
    'balance_column',
    'user_column',
    'user_id_column',
    'user_slug_column',
  ],
};

const HISTORY: TableSpec = {
  name: 'accumulated_point_transaction_history_tbl',
  copied: [
    ...BASE,
    'type_column',
    'points_column',
    'last_points_column',
    'current_points_percentage_column',
    'date_column',
    'status_column',
  ],
  compared: [
    'created_at_column',
    'deleted_at_column',
    'type_column',
    'points_column',
    'last_points_column',
    'current_points_percentage_column',
    'date_column',
    'status_column',
    'accumulated_point_column',
    'object_type_column',
    'object_id_column',
    'object_slug_column',
  ],
};

const TABLES = [BALANCE, POINTS, TRANSACTIONS, HISTORY];

interface Db {
  label: string;
  database: string;
  conn: Connection;
}

// One side's wallet, every value as text (NULL stays null).
interface Wallet {
  users: Row[];
  balances: Row[];
  points: Row[];
  transactions: Row[];
  history: Row[];
}

type Op =
  | { kind: 'insert'; table: string; row: Row }
  | { kind: 'update'; table: string; id: string; set: Row; was: Row }
  | { kind: 'link'; userId: string; pointsId: string }
  | { kind: 'key'; id: string; key: string };

interface PersonPlan {
  person: string;
  // Rows locked first, in the order of the wallet commands (points, balance).
  locks: { table: string; id: string }[];
  ops: Op[];
}

interface Plan {
  people: number;
  persons: PersonPlan[];
  equal: Record<string, number>;
  skipped: { person: string; reason: string }[];
  unmapped: string[];
}

const argValue = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  return process.argv
    .find((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length);
};

const q = (name: string): string => `\`${name}\``;

const connect = async (
  label: string,
  envPrefix: string,
  database: string,
): Promise<Db> => {
  const env = (key: string) =>
    process.env[`${envPrefix}${key}`] ?? process.env[`DATABASE_${key}`];
  const conn = await createConnection({
    host: env('HOST'),
    port: Number(env('PORT')),
    user: env('USERNAME'),
    password: env('PASSWORD'),
    database,
    // Dates and decimals travel as text: microseconds and cents copy exactly.
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  // TIMESTAMP text is read and written in the session time zone: the same
  // zone on both connections keeps every instant as it is.
  await conn.query(`SET time_zone = '+00:00'`);
  return { label, database, conn };
};

const select = async (
  db: Db,
  sql: string,
  params: unknown[] = [],
): Promise<Row[]> => {
  const [rows] = await db.conn.query<RowDataPacket[]>(sql, params);
  return rows.map((row) => {
    const out: Row = {};
    for (const [column, value] of Object.entries(row)) {
      out[column] =
        value === null || value === undefined ? null : String(value);
    }
    return out;
  });
};

const tablesNamed = async (db: Db, names: string[]): Promise<string[]> =>
  (
    await select(
      db,
      `SELECT table_name AS name FROM information_schema.tables
        WHERE table_schema = ? AND table_name IN (?)`,
      [db.database, names],
    )
  ).map((row) => row.name);

const columnsOf = async (db: Db, table: string): Promise<Set<string>> =>
  new Set(
    (
      await select(
        db,
        `SELECT column_name AS name FROM information_schema.columns
          WHERE table_schema = ? AND table_name = ?`,
        [db.database, table],
      )
    ).map((row) => row.name),
  );

// The name in use, `name` or `_deprecated_name` (rule 2).
const oneOf = (where: string, found: string[], name: string): string => {
  if (found.length !== 1) {
    throw new Error(
      `${where}: expected exactly one of ${name} / _deprecated_${name}, ` +
        `found ${found.length} (${found.join(', ')})`,
    );
  }
  return found[0];
};

const resolveTable = async (db: Db, name: string): Promise<string> =>
  oneOf(
    db.database,
    await tablesNamed(db, [name, `_deprecated_${name}`]),
    name,
  );

const resolveColumn = (
  db: Db,
  table: string,
  columns: Set<string>,
  name: string,
): string =>
  oneOf(
    `${db.database}.${table}`,
    [name, `_deprecated_${name}`].filter((column) => columns.has(column)),
    name,
  );

const requireColumns = (
  db: Db,
  table: string,
  columns: Set<string>,
  names: string[],
): void => {
  const missing = names.filter((name) => !columns.has(name));
  if (missing.length) {
    throw new Error(
      `${db.database}.${table} has no column ${missing.join(', ')}` +
        ' - run every migration first',
    );
  }
};

const list = (columns: string[], alias?: string): string =>
  columns
    .map((column) => (alias ? `${alias}.${q(column)}` : q(column)))
    .join(', ');

// Both sides are read inside one snapshot each, so the four tables agree.
const inSnapshot = async <T>(db: Db, read: () => Promise<T>): Promise<T> => {
  await db.conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  try {
    return await read();
  } finally {
    await db.conn.query('COMMIT');
  }
};

const readTrend = async (
  db: Db,
): Promise<{ wallet: Wallet; names: string[] }> => {
  const table: Record<string, string> = {};
  for (const spec of TABLES)
    table[spec.name] = await resolveTable(db, spec.name);
  const userColumns = await columnsOf(db, USER_TABLE);
  requireColumns(db, USER_TABLE, userColumns, [
    'id_column',
    'shared_user_id_column',
  ]);
  const link = resolveColumn(db, USER_TABLE, userColumns, POINTS_LINK);
  const owner: Record<string, string[]> = {
    [BALANCE.name]: ['user_column'],
    [POINTS.name]: [],
    [TRANSACTIONS.name]: ['user_column'],
    [HISTORY.name]: ['accumulated_point_column'],
  };
  for (const spec of TABLES) {
    const columns = await columnsOf(db, table[spec.name]);
    requireColumns(db, table[spec.name], columns, [
      ...spec.copied,
      ...owner[spec.name],
    ]);
  }
  const order = resolveColumn(
    db,
    table[HISTORY.name],
    await columnsOf(db, table[HISTORY.name]),
    'order_column',
  );
  requireColumns(db, ORDER_TABLE, await columnsOf(db, ORDER_TABLE), [
    'id_column',
    'slug_column',
  ]);

  const wallet = await inSnapshot(db, async () => ({
    users: await select(
      db,
      `SELECT id_column, shared_user_id_column, ${q(link)} AS ${q(POINTS_LINK)}
         FROM ${q(USER_TABLE)}`,
    ),
    balances: await select(
      db,
      `SELECT ${list([...BALANCE.copied, 'user_column'])} FROM ${q(table[BALANCE.name])}`,
    ),
    points: await select(
      db,
      `SELECT ${list(POINTS.copied)} FROM ${q(table[POINTS.name])}`,
    ),
    transactions: await select(
      db,
      `SELECT ${list([...TRANSACTIONS.copied, 'user_column'])}
         FROM ${q(table[TRANSACTIONS.name])}`,
    ),
    history: await select(
      db,
      `SELECT ${list([...HISTORY.copied, 'accumulated_point_column'], 'h')},
              h.${q(order)} AS order_id, o.slug_column AS order_slug
         FROM ${q(table[HISTORY.name])} h
         LEFT JOIN ${q(ORDER_TABLE)} o ON o.id_column = h.${q(order)}`,
    ),
  }));
  return {
    wallet,
    names: [...TABLES.map((spec) => table[spec.name]), `${USER_TABLE}.${link}`],
  };
};

const readShared = async (db: Db): Promise<Wallet> => {
  const owner: Record<string, string[]> = {
    [BALANCE.name]: ['user_column', KEY],
    [POINTS.name]: [KEY],
    [TRANSACTIONS.name]: [
      'user_column',
      'user_id_column',
      'user_slug_column',
      KEY,
    ],
    [HISTORY.name]: [
      'accumulated_point_column',
      'object_type_column',
      'object_id_column',
      'object_slug_column',
      KEY,
    ],
  };
  for (const spec of TABLES) {
    const columns = await columnsOf(db, spec.name);
    requireColumns(db, spec.name, columns, [
      ...spec.copied,
      ...owner[spec.name],
    ]);
  }
  // v4.0.0-05: the index that allows one open reservation per points row and service.
  requireColumns(db, HISTORY.name, await columnsOf(db, HISTORY.name), [
    'active_reservation_key_column',
  ]);
  requireColumns(db, USER_TABLE, await columnsOf(db, USER_TABLE), [
    'id_column',
    'slug_column',
    POINTS_LINK,
  ]);
  return inSnapshot(db, async () => ({
    users: await select(
      db,
      `SELECT id_column, slug_column, ${q(POINTS_LINK)} FROM ${q(USER_TABLE)}`,
    ),
    balances: await select(
      db,
      `SELECT ${list([...BALANCE.copied, ...owner[BALANCE.name]])} FROM ${q(BALANCE.name)}`,
    ),
    points: await select(
      db,
      `SELECT ${list([...POINTS.copied, ...owner[POINTS.name]])} FROM ${q(POINTS.name)}`,
    ),
    transactions: await select(
      db,
      `SELECT ${list([...TRANSACTIONS.copied, ...owner[TRANSACTIONS.name]])}
         FROM ${q(TRANSACTIONS.name)}`,
    ),
    history: await select(
      db,
      `SELECT ${list([...HISTORY.copied, ...owner[HISTORY.name]])} FROM ${q(HISTORY.name)}`,
    ),
  }));
};

const byId = (rows: Row[]): Map<string, Row> =>
  new Map(rows.map((row) => [row.id_column, row]));

const groupBy = (rows: Row[], column: string): Map<string, Row[]> => {
  const out = new Map<string, Row[]>();
  for (const row of rows) {
    const value = row[column];
    if (value === null) continue;
    if (!out.has(value)) out.set(value, []);
    out.get(value).push(row);
  }
  return out;
};

const pick = (row: Row, columns: string[]): Row =>
  Object.fromEntries(columns.map((column) => [column, row[column]]));

const isOpenReservation = (row: Row): boolean =>
  row.type_column === 'reserve' &&
  row.status_column === 'pending' &&
  row.deleted_at_column === null;

const diff = (spec: TableSpec, expected: Row, existing: Row): Op | null => {
  const changed = spec.compared.filter(
    (column) => expected[column] !== existing[column],
  );
  if (!changed.length) return null;
  const set: Row = {};
  const was: Row = {};
  for (const column of changed) {
    set[column] = expected[column];
    was[column] = existing[column];
  }
  set.updated_at_column = expected.updated_at_column;
  return { kind: 'update', table: spec.name, id: existing.id_column, set, was };
};

interface Bundle {
  balances: Row[];
  points: Row[];
  transactions: Row[];
  history: Row[];
}

const buildPlan = (trend: Wallet, shared: Wallet): Plan => {
  const plan: Plan = {
    people: 0,
    persons: [],
    equal: Object.fromEntries(TABLES.map((spec) => [spec.name, 0])),
    skipped: [],
    unmapped: [],
  };

  const trendUsers = byId(trend.users);
  const trendUsersOfPerson = groupBy(trend.users, 'shared_user_id_column');
  const trendUserOfPoints = new Map(
    trend.users
      .filter((user) => user[POINTS_LINK] !== null)
      .map((user) => [user[POINTS_LINK], user.id_column]),
  );
  const sharedUsers = byId(shared.users);

  const bundles = new Map<string, Bundle>();
  const personOf = (userId: Value, what: string): string | null => {
    const user = userId === null ? undefined : trendUsers.get(userId);
    const person = user?.shared_user_id_column ?? null;
    if (!user) {
      plan.unmapped.push(`${what}: trend user ${userId ?? 'NULL'} not found`);
    } else if (person === null) {
      plan.unmapped.push(`${what}: trend user ${userId} has no shared_user_id`);
    } else if (!sharedUsers.has(person)) {
      plan.unmapped.push(`${what}: person ${person} is not on shared-user`);
    } else {
      return person;
    }
    return null;
  };
  const add = (person: string | null, part: keyof Bundle, row: Row) => {
    if (person === null) return;
    if (!bundles.has(person)) {
      bundles.set(person, {
        balances: [],
        points: [],
        transactions: [],
        history: [],
      });
    }
    bundles.get(person)[part].push(row);
  };
  const viaPoints = (pointsId: Value, what: string): string | null => {
    const userId =
      pointsId === null ? undefined : trendUserOfPoints.get(pointsId);
    if (!userId) {
      plan.unmapped.push(
        `${what}: no trend user holds points row ${pointsId ?? 'NULL'}`,
      );
      return null;
    }
    return personOf(userId, what);
  };
  for (const row of trend.balances) {
    add(personOf(row.user_column, `balance ${row.id_column}`), 'balances', row);
  }
  for (const row of trend.points) {
    add(viaPoints(row.id_column, `points ${row.id_column}`), 'points', row);
  }
  for (const row of trend.transactions) {
    add(
      personOf(row.user_column, `coin transaction ${row.id_column}`),
      'transactions',
      row,
    );
  }
  for (const row of trend.history) {
    add(
      viaPoints(row.accumulated_point_column, `point history ${row.id_column}`),
      'history',
      row,
    );
  }

  const sharedBalancesOf = groupBy(shared.balances, 'user_column');
  const sharedPoints = byId(shared.points);
  const sharedTransactions = byId(shared.transactions);
  const sharedTransactionsOf = groupBy(shared.transactions, 'user_column');
  const sharedHistory = byId(shared.history);
  const sharedHistoryOf = groupBy(shared.history, 'accumulated_point_column');
  const trendTransactionIds = new Set(
    trend.transactions.map((row) => row.id_column),
  );
  const trendHistoryIds = new Set(trend.history.map((row) => row.id_column));
  const taken = (rows: Row[]) => ({
    ids: new Set(rows.map((row) => row.id_column)),
    slugs: new Map(rows.map((row) => [row.slug_column, row.id_column])),
  });
  const used = {
    [BALANCE.name]: taken(shared.balances),
    [POINTS.name]: taken(shared.points),
    [TRANSACTIONS.name]: taken(shared.transactions),
    [HISTORY.name]: taken(shared.history),
  };
  // An insert keeps trend's id and slug: both must be free on shared-user.
  const clashOf = (spec: TableSpec, row: Row): string | null => {
    if (used[spec.name].ids.has(row.id_column)) {
      return `${spec.name} id ${row.id_column} already used on shared-user`;
    }
    const holder = used[spec.name].slugs.get(row.slug_column);
    if (holder !== undefined && holder !== row.id_column) {
      return `${spec.name} slug ${row.slug_column} of ${row.id_column} already used by ${holder}`;
    }
    return null;
  };

  for (const [person, source] of bundles) {
    plan.people += 1;
    const skip = (reason: string) => plan.skipped.push({ person, reason });
    const user = sharedUsers.get(person);
    const trendUserIds = trendUsersOfPerson.get(person) ?? [];
    if (trendUserIds.length > 1) {
      skip(`${trendUserIds.length} trend users share this person`);
      continue;
    }
    if (source.balances.length > 1 || source.points.length > 1) {
      skip('trend holds more than one balance or points row for this person');
      continue;
    }

    const targetBalances = sharedBalancesOf.get(person) ?? [];
    const targetPoints =
      user[POINTS_LINK] === null
        ? undefined
        : sharedPoints.get(user[POINTS_LINK]);
    const ownWrites = [
      ...(sharedTransactionsOf.get(person) ?? [])
        .filter((row) => !trendTransactionIds.has(row.id_column))
        .map((row) => `coin transaction ${row.id_column}`),
      ...(targetPoints
        ? (sharedHistoryOf.get(targetPoints.id_column) ?? [])
        : []
      )
        .filter((row) => !trendHistoryIds.has(row.id_column))
        .map((row) => `point history ${row.id_column}`),
      ...targetBalances
        .filter((row) => row[KEY] !== null)
        .map((row) => `balance ${row.id_column} keyed ${row[KEY]}`),
      ...(targetPoints?.[KEY]
        ? [`points ${targetPoints.id_column} keyed ${targetPoints[KEY]}`]
        : []),
    ];
    if (ownWrites.length) {
      skip(
        `shared-user already wrote to this wallet on its own (${ownWrites.length}: ` +
          `${ownWrites.slice(0, 3).join(', ')}${ownWrites.length > 3 ? ', ...' : ''})`,
      );
      continue;
    }
    const open = source.history.filter(isOpenReservation);
    if (open.length > 1) {
      skip(
        `trend holds ${open.length} open reservations ` +
          `(${open.map((row) => row.id_column).join(', ')}) - close all but one in trend first`,
      );
      continue;
    }
    const lost = source.history.filter(
      (row) => row.order_id !== null && row.order_slug === null,
    );
    if (lost.length) {
      skip(
        `point history ${lost.map((row) => row.id_column).join(', ')} ` +
          'refers to an order trend no longer has',
      );
      continue;
    }

    const conflicts: string[] = [];
    const ops: Op[] = [];
    const locks: PersonPlan['locks'] = [];
    const insert = (spec: TableSpec, row: Row) => {
      const clash = clashOf(spec, row);
      if (clash) conflicts.push(clash);
      else ops.push({ kind: 'insert', table: spec.name, row });
    };
    const update = (spec: TableSpec, expected: Row, existing: Row) => {
      const op = diff(spec, expected, existing);
      if (op) ops.push(op);
      else plan.equal[spec.name] += 1;
    };

    let pointsId = targetPoints?.id_column ?? null;
    const [sourcePoints] = source.points;
    if (targetPoints)
      locks.push({ table: POINTS.name, id: targetPoints.id_column });
    if (sourcePoints) {
      const expected = pick(sourcePoints, POINTS.copied);
      if (targetPoints) {
        update(POINTS, expected, targetPoints);
      } else {
        insert(POINTS, expected);
        ops.push({
          kind: 'link',
          userId: person,
          pointsId: sourcePoints.id_column,
        });
        pointsId = sourcePoints.id_column;
      }
    }

    const [sourceBalance] = source.balances;
    if (sourceBalance) {
      const expected = {
        ...pick(sourceBalance, BALANCE.copied),
        user_column: person,
      };
      if (targetBalances.length > 1) {
        conflicts.push(`${targetBalances.length} balance rows on shared-user`);
      } else if (targetBalances.length === 1) {
        locks.push({ table: BALANCE.name, id: targetBalances[0].id_column });
        update(BALANCE, expected, targetBalances[0]);
      } else {
        insert(BALANCE, expected);
      }
    }

    const keys: Op[] = [];
    for (const row of source.transactions) {
      const expected: Row = {
        ...pick(row, TRANSACTIONS.copied),
        user_column: person,
        user_id_column: person,
        user_slug_column: user.slug_column,
      };
      const existing = sharedTransactions.get(row.id_column);
      if (!existing) {
        insert(TRANSACTIONS, {
          ...expected,
          [KEY]: legacyKeyOf(row.id_column),
        });
        continue;
      }
      if (existing.user_column !== person) {
        conflicts.push(
          `coin transaction ${row.id_column} belongs to ${existing.user_column} on shared-user`,
        );
        continue;
      }
      update(TRANSACTIONS, expected, existing);
      if (existing[KEY] === null) {
        keys.push({
          kind: 'key',
          id: row.id_column,
          key: legacyKeyOf(row.id_column),
        });
      } else if (existing[KEY] !== legacyKeyOf(row.id_column)) {
        conflicts.push(
          `coin transaction ${row.id_column} carries key ${existing[KEY]}`,
        );
      }
    }
    ops.push(...keys);

    // Rows that close a reservation go before rows that open one, so the
    // open reservation index never sees two at once.
    const historyOps: { op: Op; opens: boolean }[] = [];
    for (const row of source.history) {
      const expected: Row = {
        ...pick(row, HISTORY.copied),
        accumulated_point_column: pointsId,
        object_type_column: row.order_id === null ? null : ORDER_OBJECT_TYPE,
        object_id_column: row.order_id,
        object_slug_column:
          row.order_id === null ? null : objectSlugOf(row.order_slug),
      };
      const opens = isOpenReservation(expected);
      const existing = sharedHistory.get(row.id_column);
      if (!existing) {
        const clash = clashOf(HISTORY, expected);
        if (clash) conflicts.push(clash);
        else
          historyOps.push({
            op: { kind: 'insert', table: HISTORY.name, row: expected },
            opens,
          });
        continue;
      }
      if (existing.accumulated_point_column !== pointsId) {
        conflicts.push(
          `point history ${row.id_column} belongs to points row ` +
            `${existing.accumulated_point_column} on shared-user`,
        );
        continue;
      }
      const op = diff(HISTORY, expected, existing);
      if (op) historyOps.push({ op, opens });
      else plan.equal[HISTORY.name] += 1;
    }
    for (const kind of ['update', 'insert'] as const) {
      for (const opens of [false, true]) {
        ops.push(
          ...historyOps
            .filter((entry) => entry.op.kind === kind && entry.opens === opens)
            .map((entry) => entry.op),
        );
      }
    }

    if (conflicts.length) {
      skip(conflicts.join('; '));
      continue;
    }
    if (ops.length) plan.persons.push({ person, locks, ops });
  }
  return plan;
};

const opsOf = (plan: Plan): Op[] =>
  plan.persons.flatMap((person) => person.ops);

const countsOf = (plan: Plan) => {
  const ops = opsOf(plan);
  const count = (kind: Op['kind'], table?: string) =>
    ops.filter(
      (op) =>
        op.kind === kind &&
        (table === undefined || ('table' in op && op.table === table)),
    ).length;
  return {
    people: plan.people,
    personsToWrite: plan.persons.length,
    writes: ops.length,
    tables: Object.fromEntries(
      TABLES.map((spec) => [
        spec.name,
        {
          insert: count('insert', spec.name),
          update: count('update', spec.name),
          equal: plan.equal[spec.name],
        },
      ]),
    ),
    legacyKeys: count('key'),
    pointsLinks: count('link'),
    skipped: plan.skipped.length,
    unmapped: plan.unmapped.length,
  };
};

const describeOp = (op: Op): string => {
  switch (op.kind) {
    case 'insert':
      return `insert ${op.table} ${op.row.id_column}`;
    case 'update':
      return (
        `update ${op.table} ${op.id} ` +
        Object.keys(op.was)
          .map((column) => `${column}: ${op.was[column]} -> ${op.set[column]}`)
          .join(', ')
      );
    case 'link':
      return `link ${USER_TABLE} ${op.userId} -> points ${op.pointsId}`;
    case 'key':
      return `key ${TRANSACTIONS.name} ${op.id} = ${op.key}`;
  }
};

const printPlan = (plan: Plan, verbose: boolean): void => {
  const counts = countsOf(plan);
  for (const spec of TABLES) {
    const table = counts.tables[spec.name];
    logger.log(
      `  ${spec.name.padEnd(42)} insert ${table.insert}, update ${table.update}, ` +
        `already equal ${table.equal}`,
    );
  }
  logger.log(
    `  legacy keys on coin transactions ${counts.legacyKeys}, ` +
      `${USER_TABLE}.${POINTS_LINK} links ${counts.pointsLinks}`,
  );
  if (verbose) {
    for (const person of plan.persons) {
      for (const op of person.ops)
        logger.log(`    ${person.person}  ${describeOp(op)}`);
    }
  }
  for (const { person, reason } of plan.skipped) {
    logger.warn(`  LEFT ALONE ${person}: ${reason}`);
  }
  for (const line of plan.unmapped) logger.warn(`  NO PERSON  ${line}`);
  logger.log(
    `Total: ${counts.people} person(s) with a wallet on trend, ${counts.personsToWrite} to write ` +
      `(${counts.writes} write(s)), ${counts.skipped} left alone, ` +
      `${counts.unmapped} trend row(s) without a person`,
  );
};

const expectOne = (result: ResultSetHeader, what: string): void => {
  if (result.affectedRows !== 1) {
    throw new Error(
      `${what} changed between the read and the write (affectedRows=${result.affectedRows})`,
    );
  }
};

const runOp = async (db: Db, op: Op): Promise<void> => {
  switch (op.kind) {
    case 'insert': {
      const columns = Object.keys(op.row);
      await db.conn.query(
        `INSERT INTO ${q(op.table)} (${list(columns)}) VALUES (?)`,
        [columns.map((column) => op.row[column])],
      );
      return;
    }
    case 'update': {
      const set = Object.keys(op.set);
      const was = Object.keys(op.was);
      const [result] = await db.conn.query<ResultSetHeader>(
        `UPDATE ${q(op.table)} SET ${set.map((column) => `${q(column)} = ?`).join(', ')}
          WHERE id_column = ? AND ${was.map((column) => `${q(column)} <=> ?`).join(' AND ')}`,
        [
          ...set.map((column) => op.set[column]),
          op.id,
          ...was.map((column) => op.was[column]),
        ],
      );
      expectOne(result, `${op.table} ${op.id}`);
      return;
    }
    case 'link': {
      const [result] = await db.conn.query<ResultSetHeader>(
        `UPDATE ${q(USER_TABLE)} SET ${q(POINTS_LINK)} = ?, updated_at_column = updated_at_column
          WHERE id_column = ? AND ${q(POINTS_LINK)} IS NULL`,
        [op.pointsId, op.userId],
      );
      expectOne(result, `${USER_TABLE} ${op.userId}`);
      return;
    }
    case 'key': {
      const [result] = await db.conn.query<ResultSetHeader>(
        `UPDATE ${q(TRANSACTIONS.name)} SET ${q(KEY)} = ?, updated_at_column = updated_at_column
          WHERE id_column = ? AND ${q(KEY)} IS NULL`,
        [op.key, op.id],
      );
      expectOne(result, `${TRANSACTIONS.name} ${op.id}`);
      return;
    }
  }
};

const writePerson = async (db: Db, person: PersonPlan): Promise<void> => {
  await db.conn.beginTransaction();
  try {
    for (const lock of person.locks) {
      await db.conn.query(
        `SELECT id_column FROM ${q(lock.table)} WHERE id_column = ? FOR UPDATE`,
        [lock.id],
      );
    }
    for (const op of person.ops) await runOp(db, op);
    await db.conn.commit();
  } catch (error) {
    await db.conn.rollback();
    throw error;
  }
};

const main = async (): Promise<void> => {
  const shouldExecute = process.argv.includes('--execute');
  const verbose = process.argv.includes('--verbose');
  const trendName = argValue('trend-db');
  const sharedName = argValue('shared-db') ?? process.env.DATABASE_NAME;
  if (!trendName) throw new Error('Missing --trend-db=<trend database>');
  if (!sharedName)
    throw new Error('Missing DATABASE_NAME in .env or --shared-db=');
  if (trendName === sharedName)
    throw new Error('--trend-db and the shared-user database are the same');

  const dbs: Db[] = [];
  try {
    const trendDb = await connect('trend', 'TREND_DATABASE_', trendName);
    dbs.push(trendDb);
    const sharedDb = await connect('shared-user', 'DATABASE_', sharedName);
    dbs.push(sharedDb);

    const startedAt = Date.now();
    const trend = await readTrend(trendDb);
    const plan = buildPlan(trend.wallet, await readShared(sharedDb));
    const readMs = Date.now() - startedAt;
    const mode = shouldExecute ? 'EXECUTE' : 'DRY RUN';
    logger.log(
      `${mode} - trend ${trendName} (${trend.names.join(', ')}) -> shared-user ${sharedName}`,
    );
    printPlan(plan, verbose);
    const summary: Record<string, unknown> = {
      mode,
      trend: trendName,
      shared: sharedName,
      readMs,
      plan: countsOf(plan),
      skipped: plan.skipped,
      unmapped: plan.unmapped,
    };
    if (!shouldExecute) {
      logger.log('DRY RUN - nothing written. Add --execute to write.');
      logger.log(`SUMMARY ${JSON.stringify(summary)}`);
      return;
    }

    const failures: { person: string; reason: string }[] = [];
    const writeStart = Date.now();
    for (const person of plan.persons) {
      try {
        await writePerson(sharedDb, person);
      } catch (error) {
        failures.push({ person: person.person, reason: error.message });
        logger.error(
          `  FAILED ${person.person}: ${error.message} - rolled back`,
        );
      }
    }
    summary.writeMs = Date.now() - writeStart;
    summary.failures = failures;

    // Check again from both databases rather than trusting the plan.
    const checkStart = Date.now();
    const after = buildPlan(
      (await readTrend(trendDb)).wallet,
      await readShared(sharedDb),
    );
    summary.checkMs = Date.now() - checkStart;
    summary.after = countsOf(after);
    const left = opsOf(after).length;
    logger.log(
      `Check after writing: ${left} write(s) left (expected 0), ` +
        `${after.skipped.length} person(s) left alone, ${after.unmapped.length} row(s) without a person, ` +
        `${failures.length} failure(s)`,
    );
    logger.log(`SUMMARY ${JSON.stringify(summary)}`);
    if (
      left ||
      failures.length ||
      after.skipped.length ||
      after.unmapped.length
    ) {
      process.exitCode = 1;
    }
  } finally {
    await Promise.all(dbs.map((db) => db.conn.end()));
  }
};

main().catch((error) => {
  logger.error(`ERROR: ${error.message}`);
  process.exit(1);
});
