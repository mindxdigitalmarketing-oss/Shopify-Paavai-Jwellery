#!/usr/bin/env node
/**
 * Fulfils unfulfilled orders on paavaijewellery.myshopify.com and adds a tracking number to each,
 * so AfterShip picks them up. Saves doing it order by order in the Shopify admin.
 *
 *   node integrations/fulfill_orders_with_tracking.js                       # list what it WOULD do; changes nothing
 *   node integrations/fulfill_orders_with_tracking.js --live --confirm-store=paavaijewellery.myshopify.com
 *
 * Which orders (default: only your own test orders, never real customers):
 *   --tag=TEST-DATA            orders carrying this tag (default)
 *   --mine                     orders whose email is an alias of SEED_EMAIL_BASE (you+anything@gmail.com)
 *   --all-unfulfilled          EVERY unfulfilled order. Real customers are included, so this also
 *                              needs --yes-include-real-customers
 * Other options:
 *   --limit=50                 most orders to touch in one run
 *   --tracking-file=file.csv   real numbers, one per line: orderName,carrier,trackingNumber (e.g. #1001,Delhivery,1234567890123)
 *                              Without it, made-up numbers are used and AfterShip will show them as "not found".
 *   --notify                   let Shopify email the customer a shipping confirmation (off by default)
 *
 * Needs in .env: SHOPIFY_ADMIN_API_TOKEN with scopes read_orders, write_merchant_managed_fulfillment_orders,
 * read_merchant_managed_fulfillment_orders. Optional: SHOPIFY_STORE_DOMAIN, SEED_EMAIL_BASE (for --mine).
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : true];
  }),
);
const LIVE = args.live === true;
const LIMIT = Number(args.limit ?? 50);
const NOTIFY = args.notify === true;
const API_VERSION = '2025-07';

function loadEnv() {
  const file = join(root, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
loadEnv();

const token = process.env.SHOPIFY_ADMIN_API_TOKEN;
const domain = process.env.SHOPIFY_STORE_DOMAIN || 'paavaijewellery.myshopify.com';
if (!token) throw new Error('SHOPIFY_ADMIN_API_TOKEN is missing from .env');

async function gql(query, variables) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401 || res.status === 403) throw new Error(`Shopify rejected the token (HTTP ${res.status}). Check the token and its scopes.`);
    const body = await res.json().catch(() => ({}));
    const throttled = res.status === 429 || body.errors?.some((e) => e.extensions?.code === 'THROTTLED');
    if (throttled) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
    if (body.errors) throw new Error(`GraphQL error: ${JSON.stringify(body.errors)}`);
    return body.data;
  }
  throw new Error('Still throttled after several retries; try again later.');
}

// ---- which orders ----
let filter;
let mineOnly = null; // set by --mine: exact check on the order email
if (args['all-unfulfilled'] === true) {
  if (args['yes-include-real-customers'] !== true) throw new Error('--all-unfulfilled includes real customers. Add --yes-include-real-customers if you really mean it.');
  filter = 'fulfillment_status:unfulfilled';
} else if (args.mine === true) {
  const base = process.env.SEED_EMAIL_BASE;
  if (!base || !base.includes('@')) throw new Error('--mine needs SEED_EMAIL_BASE in .env');
  // Search broadly by prefix, then keep only your plain address and its +aliases (checked below).
  filter = `fulfillment_status:unfulfilled email:${base.split('@')[0].split('+')[0]}*`;
  const [user, host] = base.toLowerCase().split('@');
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  mineOnly = new RegExp(`^${escape(user.split('+')[0])}(\\+[^@]*)?@${escape(host)}$`);
} else {
  filter = `fulfillment_status:unfulfilled tag:${args.tag === true || !args.tag ? 'TEST-DATA' : args.tag}`;
}

// ---- tracking numbers ----
const fromFile = new Map();
if (typeof args['tracking-file'] === 'string') {
  for (const line of readFileSync(join(root, args['tracking-file']), 'utf8').split(/\r?\n/)) {
    const [name, carrier, number] = line.split(',').map((x) => x?.trim());
    if (name && carrier && number) fromFile.set(name.startsWith('#') ? name : `#${name}`, { carrier, number });
  }
}
const carriers = [['Delhivery', 13], ['Blue Dart', 11], ['DTDC', 9]];
const fake = (i) => {
  const [carrier, len] = carriers[i % carriers.length];
  return { carrier, number: String(10 ** (len - 1) + Math.floor(Math.random() * 9 * 10 ** (len - 1))) };
};

const ORDERS = `query($q: String!, $n: Int!) {
  orders(first: $n, query: $q, sortKey: CREATED_AT) {
    nodes { id name email displayFulfillmentStatus fulfillmentOrders(first: 10) { nodes { id status } } }
  }
}`;
const FULFILL = `mutation($f: FulfillmentInput!) {
  fulfillmentCreate(fulfillment: $f) {
    fulfillment { id status trackingInfo { company number } }
    userErrors { field message }
  }
}`;

const { orders } = await gql(ORDERS, { q: filter, n: Math.min(LIMIT, 250) });
if (mineOnly) orders.nodes = orders.nodes.filter((o) => mineOnly.test((o.email ?? '').toLowerCase()));
console.log(`${LIVE ? 'LIVE' : 'DRY RUN (nothing will change)'}: ${orders.nodes.length} order(s) match "${filter}"\n`);

let done = 0;
for (const [i, o] of orders.nodes.entries()) {
  const open = o.fulfillmentOrders.nodes.filter((f) => f.status === 'OPEN' || f.status === 'IN_PROGRESS');
  const t = fromFile.get(o.name) ?? fake(i);
  const label = `${o.name}  ${o.email ?? '(no email)'}  ->  ${t.carrier} ${t.number}${fromFile.has(o.name) ? '' : '  (made-up number)'}`;
  if (!open.length) { console.log(`skip   ${o.name}: nothing open to fulfil`); continue; }
  if (!LIVE) { console.log(`would  ${label}`); continue; }
  if (args['confirm-store'] !== domain) throw new Error(`Add --confirm-store=${domain} to confirm you want to change that store.`);

  const data = await gql(FULFILL, {
    f: {
      notifyCustomer: NOTIFY,
      trackingInfo: { company: t.carrier, number: t.number },
      lineItemsByFulfillmentOrder: open.map((f) => ({ fulfillmentOrderId: f.id })),
    },
  });
  const { userErrors } = data.fulfillmentCreate;
  if (userErrors.length) throw new Error(`${o.name} failed, stopping. ${JSON.stringify(userErrors)}`);
  console.log(`done   ${label}`);
  done++;
  await new Promise((r) => setTimeout(r, 500));
}
console.log(LIVE ? `\nFulfilled ${done} order(s). Check AfterShip -> Shipments in a few minutes.` : '\nRe-run with --live --confirm-store=' + domain + ' to apply.');
