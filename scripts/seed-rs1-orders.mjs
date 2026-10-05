#!/usr/bin/env node
/**
 * Seeds the Paavai Shopify store with realistic MOCK orders for testing the AI agent.
 *
 *   node scripts/seed-test-orders.mjs                 # preview only: no network, no token needed
 *   node scripts/seed-test-orders.mjs --live --confirm-store=paavaijewellery.myshopify.com
 *
 * Options: --count=1000  --days=30  --seed=20261001  --batch=rs1-test-2026-10
 *
 * Safety:
 *  - Preview is the default. Inserting needs --live AND --confirm-store=<the store domain>.
 *  - Every order is created with test:true (Shopify excludes test orders from sales
 *    analytics), tagged TEST-DATA, and sent with no receipt / fulfilment emails.
 *  - Customer emails use the reserved example.com/.org/.net domains, so a real person can
 *    never receive mail. Phone numbers are random Indian-format mobiles; Shopify does not
 *    SMS customers for orders created this way.
 *  - It stops at the first error so a schema or scope problem cannot create 100 bad orders,
 *    and it refuses to run twice for the same --batch.
 *
 * Needs in .env: SHOPIFY_ADMIN_API_TOKEN (scopes: write_orders, read_orders, write_customers,
 * read_products). Optional: SHOPIFY_STORE_DOMAIN (default paavaijewellery.myshopify.com).
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
const COUNT = Number(args.count ?? 1000);
const DAYS = Number(args.days ?? 30);
const SEED = Number(args.seed ?? 20261001);
const BATCH = String(args.batch ?? 'rs1-test-2026-10');
const LIVE = args.live === true;
const API_VERSION = '2025-07';
const CURRENCY = 'USD'; // the store's currency; amounts are left as-is and can be rescaled in the spreadsheet

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

// ---------- Indian names (first name, gender-matched; surname by region) ----------
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
  { title: 'RS1 Daily Drink: Monthly Pack - Monthly (30 servings)', price: 299, variantId: 'gid://shopify/ProductVariant/50598542213337' }, { title: 'RS1 Daily Drink: Travel Packs - 14 single-serve packs', price: 499, variantId: 'gid://shopify/ProductVariant/50598542377177' },
  { title: 'RS1 Starter Bundle', price: 599, variantId: 'gid://shopify/ProductVariant/50598542475481' }, { title: 'RS1 Shaker Bottle - Navy', price: 399, variantId: 'gid://shopify/ProductVariant/50598542573785' }, { title: 'RS1 Sample Pack - 5 single-serve packs', price: 399, variantId: 'gid://shopify/ProductVariant/50598542770393' },
];

// ---------- order generation ----------
const emailDomains = ['example.com', 'example.org', 'example.net'];
const slug = (s) => s.toLowerCase().replace(/[^a-z]/g, '');

function makePerson() {
  const isFemale = rnd() < 0.78; // jewellery buyers skew female
  const first = pick(isFemale ? female : male);
  const city = weighted(cities.map((c) => [c, c[3]]));
  const pool = ['TN', 'KA', 'TG', 'KL'].includes(city[1]) ? surnamesSouth : [...surnamesSouth, ...surnamesNorth];
  const last = pick(isFemale && rnd() < 0.2 ? [...pool, 'Devi'] : pool);
  const style = int(0, 3);
  const handle = [`${slug(first)}.${slug(last)}`, `${slug(first)}${slug(last)}${int(1, 99)}`, `${slug(first)}_${slug(last)}`, `${slug(first)[0]}${slug(last)}${int(70, 99)}`][style];
  return {
    first, last, city, email: `mindx.digitalmarketing+${slug(first)}.${slug(last)}${int(1, 9999)}@gmail.com`,
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
    orders.push({
      person: p, lines, subtotal, shipping, total: subtotal + shipping, placed,
      cod: rnd() < 0.15, // cash on delivery => payment pending
      fulfilled: ageDays > 6 && rnd() < 0.85,
      address: makeAddress(p),
    });
  }
  return orders.sort((a, b) => a.placed - b.placed);
}

const money = (n, cur = CURRENCY) => ({ shopMoney: { amount: n.toFixed(2), currencyCode: cur } });

function toShopifyOrder(o) {
  return {
    currency: CURRENCY,
    email: o.person.email,
    phone: o.person.phone,
    processedAt: o.placed.toISOString(),
    tags: ['TEST-DATA', BATCH, o.cod ? 'COD' : 'Prepaid'],
    note: 'Mock order for AI-agent testing',
    test: true,
    financialStatus: o.cod ? 'PENDING' : 'PAID',
    ...(o.fulfilled ? { fulfillmentStatus: 'FULFILLED' } : {}),
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
  const data = await gql(domain, token, `{ products(first: 50, query: "status:active vendor:RS1") { nodes { title variants(first: 5) { nodes { id title price } } } } }`);
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
const outDir = join(root, 'scripts', 'out');
mkdirSync(outDir, { recursive: true });

if (!LIVE) {
  const orders = makeOrders(SAMPLE_CATALOG);
  writeFileSync(join(outDir, 'seed-preview.json'), JSON.stringify(orders.map(toShopifyOrder), null, 2));
  const total = orders.reduce((s, o) => s + o.total, 0);
  console.log(`PREVIEW only. Nothing was sent to Shopify.\n`);
  console.log(`${orders.length} orders, ${orders[0].placed.toISOString().slice(0, 10)} to ${orders.at(-1).placed.toISOString().slice(0, 10)}`);
  console.log(`Total Rs ${total.toLocaleString('en-IN')}, average Rs ${Math.round(total / orders.length)}, COD ${orders.filter((o) => o.cod).length}, fulfilled ${orders.filter((o) => o.fulfilled).length}`);
  console.log(`Unique customers: ${new Set(orders.map((o) => o.person.email)).size}\n`);
  for (const o of orders.slice(0, 5))
    console.log(`${o.placed.toISOString().slice(0, 16)}  ${o.person.first} ${o.person.last} <${o.person.email}> ${o.person.phone}  ${o.address.city}  Rs ${o.total}  [${o.lines.map((l) => `${l.quantity}x ${l.title}`).join('; ')}]`);
  console.log(`\nFull payload written to scripts/out/seed-preview.json`);
} else {
  loadEnv();
  const token = process.env.SHOPIFY_ADMIN_API_TOKEN;
  const domain = process.env.SHOPIFY_STORE_DOMAIN || 'paavaijewellery.myshopify.com';
  if (!token) throw new Error('No SHOPIFY_ADMIN_API_TOKEN (or client id/secret that works) in .env');
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
  console.log(`\nDone: ${created.length} test orders created, tagged TEST-DATA and ${BATCH}. IDs saved to scripts/out/created-orders.json`);
}
