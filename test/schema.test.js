// Runs supabase/schema.sql against a real Postgres (PGlite, in-process)
// with a tiny stand-in for Supabase's auth schema, then exercises the functions.
const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

let db;
const users = {
  host: '00000000-0000-0000-0000-000000000001',
  asha: '00000000-0000-0000-0000-000000000002',
  ravi: '00000000-0000-0000-0000-000000000003',
  newbie: '00000000-0000-0000-0000-000000000004',
};

const as = async (who) => db.query(`select set_config('test.uid', $1, false)`, [who ? users[who] : '']);
const rejects = async (sql, params, re) => {
  await assert.rejects(db.query(sql, params), (e) => re.test(e.message));
};

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  `);
  for (const id of Object.values(users)) await db.query('insert into auth.users (id) values ($1)', [id]);
  const schema = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  await db.exec(schema);
  await db.exec(schema); // must be safe to re-run
});

const slots = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ starts_at: `2026-10-${10 + i}T18:00:00-05:00`, note: `Option ${i + 1}` })));

test('must be signed in and registered', async () => {
  await as(null);
  await rejects(`select public.save_profile('X')`, [], /sign in/);
  await as('newbie');
  await rejects(`select public.create_event('T','','',$1::jsonb)`, [slots(3)], /registration/);
});

test('full flow', async () => {
  for (const [who, name] of [['host', 'Surendra'], ['asha', 'Asha'], ['ravi', 'Ravi']]) {
    await as(who);
    await db.query('select public.save_profile($1)', [name]);
  }
  await as('host');
  await rejects(`select public.create_event('T','','',$1::jsonb)`, [slots(1)], /between 2 and 5/);
  await rejects(`select public.create_event('T','','',$1::jsonb)`, [slots(6)], /between 2 and 5/);
  const { rows: [{ id }] } = await db.query(`select public.create_event('Sundarkand Path','Home','Bring prasad',$1::jsonb) as id`, [slots(5)]);
  const { rows: s } = await db.query('select id from public.slots where event_id=$1 order by position', [id]);
  assert.equal(s.length, 5);

  await as('asha');
  await db.query(`select public.submit_response($1, $2::uuid[], false, 'yay')`, [id, [s[0].id, s[1].id]]);
  await rejects(`select public.submit_response($1, '{}'::uuid[], false, '')`, [id], /at least one/);
  // a slot id from nowhere is ignored → nothing valid left → error
  await rejects(`select public.submit_response($1, $2::uuid[], false, '')`, [id, [users.host]], /at least one/);
  // update replaces earlier answer
  await db.query(`select public.submit_response($1, $2::uuid[], false, '')`, [id, [s[2].id]]);

  await as('ravi');
  await db.query(`select public.submit_response($1, $2::uuid[], true, 'travelling')`, [id, [s[0].id]]);

  const { rows: r } = await db.query('select user_id, choices, declined from public.responses where event_id=$1 order by user_id', [id]);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0].choices, [s[2].id]);
  assert.equal(r[1].declined, true);
  assert.deepEqual(r[1].choices, [], 'decline clears choices');

  await rejects(`select public.finalize_event($1, $2)`, [id, s[2].id], /Only the host/);
  await as('host');
  await rejects(`select public.finalize_event($1, $2)`, [id, users.host], /Unknown slot/);
  await db.query(`select public.finalize_event($1, $2)`, [id, s[2].id]);

  await as('asha');
  await rejects(`select public.submit_response($1, $2::uuid[], false, '')`, [id, [s[0].id]], /already confirmed/);

  await as('host');
  await db.query(`select public.finalize_event($1, null)`, [id]); // reopen
  await as('asha');
  await db.query(`select public.submit_response($1, $2::uuid[], false, '')`, [id, [s[0].id]]);
});
