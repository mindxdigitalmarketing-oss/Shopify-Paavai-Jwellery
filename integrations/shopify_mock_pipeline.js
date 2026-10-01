#!/usr/bin/env node
/**
 * Shopify mock order pipeline: 100 realistic MOCK orders for paavaijewellery.myshopify.com,
 * with mock Judge.me (review request) and AfterShip (tracking) data for testing the AI agent.
 *
 *   node integrations/shopify_mock_pipeline.js                 # preview only: no network, no token
 *   node integrations/shopify_mock_pipeline.js --live --confirm-store=paavaijewellery.myshopify.com
 *
 * Options: --count=100  --days=30  --seed=20261001  --batch=agent-test-2026-10
 *          --email=you@gmail.com   (or SEED_EMAIL_BASE in .env; required with --live)
 *          --real-tracking         also write the tracking number into the Shopify fulfilment
 *
 * Customer emails are plus-aliases of YOUR address (you+priya.subramanian@gmail.com), so every
 * email Judge.me or AfterShip sends lands in your own inbox and never reaches anyone else.
 * Keep your address out of this file: this repository is public.
 *
 * Judge.me / AfterShip data is written as order METAFIELDS (namespace "agent_test") and tags.
 * The script never calls either app and creates no reviews. Tracking numbers are NOT put on the
 * Shopify fulfilment by default: AfterShip imports fulfilment tracking numbers and looks them
 * up with the carriers (the fake ones will show "not found"). Add --real-tracking to test that.
 * Orders are Shopify test orders (test:true), so the apps may skip them.
 *
 * Safety:
 *  - Preview is the default. Inserting needs --live AND --confirm-store=<the store domain>.
 *  - Every order is tagged TEST-DATA, with no receipt or fulfilment emails sent by Shopify.
 *  - It stops at the first error and refuses to run twice for the same --batch.
 *
 * Needs in .env: SHOPIFY_ADMIN_API_TOKEN (scopes: write_orders, read_orders, write_customers,
 * read_products) and SEED_EMAIL_BASE. Optional: SHOPIFY_STORE_DOMAIN.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const COUNT = Number(args.count ?? 100);
const DAYS = Number(args.days ?? 30);
const SEED = Number(args.seed ?? 20261001);
const BATCH = String(args.batch ?? 'agent-test-2026-10');
const LIVE = args.live === true;
const REAL_TRACKING = args['real-tracking'] === true;
const API_VERSION = '2025-07';

// ---------- seeded random, so the same --seed gives the same 100 orders ----------
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const weighted = (pairs) => {
  let r = rnd() * pairs.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of pairs) if ((r -= w) < 0) return v;
  return pairs[0][0];
};

// ---------- Indian names ----------
const female = ['Priya', 'Divya', 'Lakshmi', 'Meena', 'Kavitha', 'Anitha', 'Swathi', 'Deepa', 'Nandhini', 'Revathi', 'Sangeetha', 'Pooja', 'Ananya', 'Shruti', 'Aishwarya', 'Harini', 'Vaishnavi', 'Keerthana', 'Janani', 'Mythili', 'Neha', 'Riya', 'Sneha', 'Aarthi', 'Bhavani'];
const male = ['Karthik', 'Arun', 'Vignesh', 'Suresh', 'Rajesh', 'Dinesh', 'Ganesh', 'Prakash', 'Senthil', 'Balaji', 'Vivek', 'Rahul', 'Aditya', 'Manoj', 'Naveen', 'Sathish', 'Harish', 'Ramesh', 'Gokul', 'Hari'];
const surnamesSouth = ['Subramanian', 'Krishnan', 'Raman', 'Iyer', 'Natarajan', 'Venkatesan', 'Murugan', 'Selvam', 'Rajan', 'Pillai', 'Nair', 'Reddy', 'Naidu', 'Chandran', 'Sundaram', 'Narayanan', 'Balasubramanian', 'Kumar', 'Ramachandran'];
const surnamesNorth = ['Sharma', 'Gupta', 'Verma', 'Singh', 'Agarwal', 'Mehta', 'Patel', 'Joshi', 'Kapoor', 'Malhotra', 'Bose', 'Banerjee', 'Das', 'Shah', 'Desai'];

// ---------- cities: real city/state/pincode-prefix triples (weighted toward Tamil Nadu) ----------
const cities = [
  ['Chennai', 'TN', '600', 14], ['Coimbatore', 'TN', '641', 9], ['Madurai', 'TN', '625', 7], ['Tiruchirappalli', 'TN', '620', 5],
  ['Salem', 'TN', '636', 3], ['Tirunelveli', 'TN', '627', 3],
  ['Bengaluru', 'KA', '560', 10], ['Hyderabad', 'TG', '500', 7], ['Kochi', 'KL', '682', 4], ['Thiruvananthapuram', 'KL', '695', 3],
  ['Mumbai', 'MH', '400', 8], ['Pune', 'MH', '411', 4], ['New Delhi', 'DL', '110', 6], ['Gurugram', 'HR', '122', 2],
  ['Kolkata', 'WB', '700', 3], ['Ahmedabad', 'GJ', '380', 3], ['Jaipur', 'RJ', '302', 2], ['Lucknow', 'UP', '226', 2],
];
const streets = ['Gandhi Road', 'Anna Salai', 'Nehru Street', 'Temple Street', 'MG Road', 'Park Avenue', 'Lake View Road', 'Raja Street', 'Market Road', 'Station Road', 'Bharathi Nagar Main Road', 'Kamarajar Salai', 'Cross Street'];
const areas = ['Anna Nagar', 'T Nagar', 'RS Puram', 'Adyar', 'Indiranagar', 'Jubilee Hills', 'Koramangala', 'Velachery', 'Gandhipuram', 'Banjara Hills', 'Salt Lake', 'Andheri West', 'Vyttila', 'Satellite', 'Malviya Nagar'];

// Preview-only catalogue, used when not connected. In --live the real products are fetched.
const SAMPLE_CATALOG = [
  { title: 'Temple Jewellery Haram', price: 3499 }, { title: 'Antique Gold-Plated Jhumka', price: 899 },
  { title: 'Kemp Stone Necklace Set', price: 2799 }, { title: 'Oxidised Silver Anklet (Pair)', price: 649 },
  { title: 'Pearl Drop Earrings', price: 549 }, { title: 'Bridal Choker Set', price: 5999 },
  { title: 'Lakshmi Coin Pendant Chain', price: 1899 }, { title: 'Glass Bangles Set of 12', price: 399 },
  { title: 'Polki Stud Earrings', price: 1299 }, { title: 'Mango Mala Long Necklace', price: 3299 },
];

// ---------- mock Judge.me and AfterShip data ----------
const carriers = [
  ['Delhivery', () => String(int(10 ** 12, 10 ** 13 - 1))],
  ['Blue Dart', () => String(int(10 ** 10, 10 ** 11 - 1))],
  ['DTDC', () => `${pick(['D', 'X', 'Z'])}${String(int(10 ** 7, 10 ** 8 - 1))}`],
  ['India Post', () => `EE${String(int(10 ** 8, 10 ** 9 - 1))}IN`],
];
const checkpoints = {
  InfoReceived: 'Shipment information received',
  InTransit: 'Shipment in transit, arrived at sorting hub',
  OutForDelivery: 'Out for delivery',
  Delivered: 'Delivered to customer',
  Exception: 'Delivery attempt failed, will retry',
};

function mockApps(placed, ageDays, fulfilled) {
  if (!fulfilled) return { aftership: null, judgeme: { status: 'not_due', sendAt: '' } };
  const [carrier, number] = pick(carriers);
  const transit = ageDays > 11 ? weighted([['Delivered', 90], ['Exception', 6], ['InTransit', 4]])
    : ageDays > 8 ? weighted([['Delivered', 55], ['OutForDelivery', 15], ['InTransit', 28], ['Exception', 2]])
    : weighted([['InTransit', 70], ['InfoReceived', 20], ['OutForDelivery', 10]]);
  // Judge.me asks for a review a few days after delivery. Only a status is mocked here.
  const deliveredDaysAgo = Math.max(0, ageDays - 8);
  let status = 'not_due';
  if (transit === 'Delivered') status = deliveredDaysAgo > 5 ? weighted([['sent', 55], ['reviewed', 30], ['scheduled', 15]]) : 'scheduled';
  const sendAt = status === 'not_due' ? '' : new Date(placed.getTime() + 13 * 86400000).toISOString();
  return { aftership: { carrier, number: number(), transit, checkpoint: checkpoints[transit] }, judgeme: { status, sendAt } };
}

// ---------- order generation ----------
const slug = (s) => s.toLowerCase().replace(/[^a-z]/g, '');

// you+alias@gmail.com: every mail lands in the owner's own inbox.
function emailBase() {
  const base = String(args.email ?? process.env.SEED_EMAIL_BASE ?? 'yourname@example.com');
  const at = base.lastIndexOf('@');
  return at > 0 ? [base.slice(0, at).split('+')[0], base.slice(at + 1)] : ['yourname', 'example.com'];
}

function makePerson() {
  const isFemale = rnd() < 0.78; // jewellery buyers skew female
  const first = pick(isFemale ? female : male);
  const city = weighted(cities.map((c) => [c, c[3]]));
  const pool = ['TN', 'KA', 'TG', 'KL'].includes(city[1]) ? surnamesSouth : [...surnamesSouth, ...surnamesNorth];
  const last = pick(isFemale && rnd() < 0.2 ? [...pool, 'Devi'] : pool);
  const [user, domain] = emailBase();
  const suffix = rnd() < 0.4 ? '' : String(int(1, 99));
  return {
    first, last, city, email: `${user}+${slug(first)}.${slug(last)}${suffix}@${domain}`,
    phone: `+91${pick(['6', '7', '8', '9'])}${String(int(0, 999999999)).padStart(9, '0')}`,
  };
}

function makeAddress(p) {
  const [name, province, prefix] = p.city;
  return {
    firstName: p.first, lastName: p.last, phone: p.phone,
    address1: `${int(1, 240)}, ${pick(streets)}`, address2: `${pick(areas)}`,
    city: name, provinceCode: province, zip: `${prefix}${String(int(1, 99)).padStart(3, '0')}`, countryCode: 'IN',
  };
}

// More orders on weekends and evenings; spread over the last DAYS days.
function makeTimestamp(i) {
  const day = Math.min(DAYS - 1, Math.floor((i / COUNT) * DAYS + rnd() * (DAYS / COUNT) * 1.5));
  const d = new Date(Date.now() - (DAYS - 1 - day) * 86400000);
  const hourIst = weighted([[9, 2], [11, 4], [13, 4], [15, 3], [18, 5], [20, 8], [21, 6], [22, 3]]);
  d.setUTCHours(hourIst - 5, int(0, 59) - 30, int(0, 59), 0);
  if (d > new Date()) d.setTime(Date.now() - int(10, 600) * 60000);
  return d;
}

function makeOrders(catalog) {
  const orders = [];
  const returning = []; // a few repeat customers, as in real data
  for (let i = 0; i < COUNT; i++) {
    const p = returning.length && rnd() < 0.12 ? pick(returning) : makePerson();
    if (returning.length < 12 && rnd() < 0.15) returning.push(p);

    const lines = [];
    const used = new Set();
    for (let n = weighted([[1, 68], [2, 26], [3, 6]]); n > 0; n--) {
      const item = pick(catalog);
      if (used.has(item.title)) continue;
      used.add(item.title);
      lines.push({ ...item, quantity: weighted([[1, 74], [2, 20], [3, 6]]) });
    }
    const subtotal = lines.reduce((s, l) => s + l.price * l.quantity, 0);
    const shipping = subtotal >= 999 ? 0 : 60;
    const placed = makeTimestamp(i);
    const ageDays = (Date.now() - placed) / 86400000;
    const cod = rnd() < 0.15; // cash on delivery => payment pending
    const fulfilled = ageDays > 6 && rnd() < 0.85;
    orders.push({
      person: p, lines, subtotal, shipping, total: subtotal + shipping, placed, cod, fulfilled,
      address: makeAddress(p),
      ...mockApps(placed, ageDays, fulfilled),
    });
  }
  return orders.sort((a, b) => a.placed - b.placed);
}

const money = (n, cur = 'INR') => ({ shopMoney: { amount: n.toFixed(2), currencyCode: cur } });
const mf = (key, value, type = 'single_line_text_field') => ({ namespace: 'agent_test', key, type, value });

function toShopifyOrder(o) {
  return {
    currency: 'INR',
    email: o.person.email,
    phone: o.person.phone,
    processedAt: o.placed.toISOString(),
    tags: ['TEST-DATA', BATCH, o.cod ? 'COD' : 'Prepaid', `judgeme-${o.judgeme.status}`, ...(o.aftership ? [`aftership-${o.aftership.transit.toLowerCase()}`] : [])],
    metafields: [
      mf('judgeme_review_request_status', o.judgeme.status),
      ...(o.judgeme.sendAt ? [mf('judgeme_review_request_send_at', o.judgeme.sendAt, 'date_time')] : []),
      ...(o.aftership ? [
        mf('aftership_tracking_number', o.aftership.number),
        mf('aftership_carrier', o.aftership.carrier),
        mf('aftership_transit_status', o.aftership.transit),
        mf('aftership_last_checkpoint', o.aftership.checkpoint),
      ] : []),
    ],
    note: 'Mock order for AI-agent testing',
    test: true,
    financialStatus: o.cod ? 'PENDING' : 'PAID',
    ...(o.fulfilled ? { fulfillmentStatus: 'FULFILLED' } : {}),
    ...(o.fulfilled && REAL_TRACKING ? { fulfillment: { trackingNumber: o.aftership.number, trackingCompany: o.aftership.carrier, notifyCustomer: false } } : {}),
    customer: { toUpsert: { email: o.person.email, firstName: o.person.first, lastName: o.person.last, phone: o.person.phone } },
    shippingAddress: o.address,
    billingAddress: o.address,
    lineItems: o.lines.map((l) => ({
      ...(l.variantId ? { variantId: l.variantId } : { title: l.title }),
      quantity: l.quantity,
      priceSet: money(l.price),
      requiresShipping: true,
    })),
    shippingLines: [{ title: o.shipping ? 'Standard shipping' : 'Free shipping', code: 'standard', priceSet: money(o.shipping) }],
    ...(o.cod ? {} : { transactions: [{ kind: 'SALE', status: 'SUCCESS', gateway: 'manual', amountSet: money(o.total) }] }),
  };
}

// ---------- Shopify access (live mode only) ----------
function loadEnv() {
  const file = join(root, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

async function gql(domain, token, query, variables) {
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

async function fetchCatalog(domain, token) {
  const data = await gql(domain, token, `{ products(first: 50, query: "status:active") { nodes { title variants(first: 5) { nodes { id title price } } } } }`);
  const items = [];
  for (const p of data.products.nodes)
    for (const v of p.variants.nodes) {
      const price = Number(v.price);
      if (price > 0) items.push({ title: v.title === 'Default Title' ? p.title : `${p.title} - ${v.title}`, price, variantId: v.id });
    }
  return items;
}

const CREATE = `mutation($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
  orderCreate(order: $order, options: $options) {
    order { id name processedAt totalPriceSet { shopMoney { amount currencyCode } } }
    userErrors { field message }
  }
}`;

// ---------- main ----------
const outDir = join(root, 'integrations', 'out');
mkdirSync(outDir, { recursive: true });

if (!LIVE) {
  const orders = makeOrders(SAMPLE_CATALOG);
  writeFileSync(join(outDir, 'pipeline-preview.json'), JSON.stringify(orders.map(toShopifyOrder), null, 2));
  const total = orders.reduce((s, o) => s + o.total, 0);
  const count = (f) => Object.entries(orders.map(f).reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`PREVIEW only. Nothing was sent to Shopify.\n`);
  console.log(`${orders.length} orders, ${orders[0].placed.toISOString().slice(0, 10)} to ${orders.at(-1).placed.toISOString().slice(0, 10)}`);
  console.log(`Total Rs ${total.toLocaleString('en-IN')}, average Rs ${Math.round(total / orders.length)}, COD ${orders.filter((o) => o.cod).length}, fulfilled ${orders.filter((o) => o.fulfilled).length}`);
  console.log(`Unique customers: ${new Set(orders.map((o) => o.person.email)).size}`);
  console.log(`AfterShip transit: ${count((o) => o.aftership?.transit ?? 'not shipped')}`);
  console.log(`Judge.me status:   ${count((o) => o.judgeme.status)}\n`);
  for (const o of orders.slice(0, 5))
    console.log(`${o.placed.toISOString().slice(0, 16)}  ${o.person.first} ${o.person.last} <${o.person.email}>  ${o.address.city}  Rs ${o.total}  [${o.lines.map((l) => `${l.quantity}x ${l.title}`).join('; ')}]  ${o.aftership ? `${o.aftership.carrier} ${o.aftership.number} ${o.aftership.transit}` : 'not shipped'}  review:${o.judgeme.status}`);
  console.log(`\nFull payload written to integrations/out/pipeline-preview.json`);
} else {
  loadEnv();
  const token = process.env.SHOPIFY_ADMIN_API_TOKEN;
  const domain = process.env.SHOPIFY_STORE_DOMAIN || 'paavaijewellery.myshopify.com';
  if (!token) throw new Error('SHOPIFY_ADMIN_API_TOKEN is missing from .env');
  if (!args.email && !process.env.SEED_EMAIL_BASE) throw new Error('Set SEED_EMAIL_BASE in .env (or pass --email=) so the mock customers use your own inbox.');
  if (args['confirm-store'] !== domain) throw new Error(`Add --confirm-store=${domain} to confirm you want to write to that store.`);

  const existing = await gql(domain, token, `query($q: String!) { orders(first: 1, query: $q) { nodes { id } } }`, { q: `tag:${BATCH}` });
  if (existing.orders.nodes.length) throw new Error(`Batch "${BATCH}" already has orders. Use --batch=<new name> to seed another set.`);

  let catalog = await fetchCatalog(domain, token);
  if (!catalog.length) { console.log('No active products found; using sample line items instead.'); catalog = SAMPLE_CATALOG; }
  else console.log(`Using ${catalog.length} real product variants from the store.`);

  const orders = makeOrders(catalog);
  const created = [];
  for (const [i, o] of orders.entries()) {
    const data = await gql(domain, token, CREATE, {
      order: toShopifyOrder(o),
      options: { inventoryBehaviour: 'BYPASS', sendReceipt: false, sendFulfillmentReceipt: false },
    });
    const { order, userErrors } = data.orderCreate;
    if (userErrors.length) {
      writeFileSync(join(outDir, 'created-orders.json'), JSON.stringify(created, null, 2));
      throw new Error(`Order ${i + 1} failed, stopping. ${JSON.stringify(userErrors)}`);
    }
    created.push({ id: order.id, name: order.name, processedAt: order.processedAt });
    console.log(`${String(i + 1).padStart(3)}/${orders.length}  ${order.name}  ${order.processedAt.slice(0, 10)}  Rs ${order.totalPriceSet.shopMoney.amount}`);
    await new Promise((r) => setTimeout(r, 600));
  }
  writeFileSync(join(outDir, 'created-orders.json'), JSON.stringify(created, null, 2));
  console.log(`\nDone: ${created.length} test orders created, tagged TEST-DATA and ${BATCH}. IDs saved to integrations/out/created-orders.json`);
}
