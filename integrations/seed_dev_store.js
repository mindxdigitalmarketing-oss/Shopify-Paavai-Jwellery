#!/usr/bin/env node
/**
 * Populates a Shopify DEVELOPMENT store with interconnected demo data for the AI agent:
 * ~32 products, 110+ customers, 320+ orders over 90 days, with repeat buyers, multiple products
 * per order, mixed fulfilment states, partial and full refunds, and products with very different
 * sales velocity (a few bestsellers, a long tail, a few slow movers).
 *
 *   node integrations/seed_dev_store.js                          # preview: no network, no token
 *   node integrations/seed_dev_store.js --live --confirm-store=<your-dev-store>.myshopify.com
 *
 * Options: --products=32 --customers=110 --orders=320 --days=90 --seed=20261001
 *          --batch=demo-2026-10  --pace-ms=12500
 *
 * Point it at a DEV store only. It refuses paavaijewellery.myshopify.com. Set the target in .env:
 *   SHOPIFY_STORE_DOMAIN=<your-dev-store>.myshopify.com
 *   SHOPIFY_ADMIN_API_TOKEN=shpat_...   (custom app on THAT store)
 *   SEED_EMAIL_BASE=you@gmail.com       (customers become you+firstname.lastname@gmail.com)
 * Token scopes: read_products, write_products, read_customers, write_customers, read_orders,
 * write_orders, read_inventory.
 *
 * Pacing: development stores limit how fast orders can be created through the API (I believe about
 * 5 a minute), hence --pace-ms=12500 (about an hour for 320 orders). On a store without that limit
 * use --pace-ms=600. The script backs off by itself if Shopify says it is going too fast.
 *
 * It is safe to re-run: products and customers already created for the same --batch are reused,
 * and orders resume where the last run stopped. It stops at the first real error.
 * Nothing is emailed: receipts and fulfilment emails are off, and customers are +aliases of you.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : true];
  }),
);
const N_PRODUCTS = Number(args.products ?? 32);
const N_CUSTOMERS = Number(args.customers ?? 110);
const N_ORDERS = Number(args.orders ?? 320);
const DAYS = Number(args.days ?? 90);
const SEED = Number(args.seed ?? 20261001);
const BATCH = String(args.batch ?? 'demo-2026-10');
const PACE_MS = Number(args['pace-ms'] ?? 12500);
const LIVE = args.live === true;
const LIVE_STORE = 'paavaijewellery.myshopify.com';
const API_VERSION = '2025-07';

// ---------- seeded random ----------
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
const slug = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- catalogue: [title, category, price INR, sales weight] ----------
// Weight is the sales velocity: a few bestsellers, a long tail, and some slow movers.
const CATALOG = [
  ['Temple Jewellery Haram', 'Necklaces', 3499, 10], ['Kemp Stone Necklace Set', 'Necklaces', 2799, 8],
  ['Mango Mala Long Necklace', 'Necklaces', 3299, 6], ['Lakshmi Coin Pendant Chain', 'Pendants', 1899, 9],
  ['Pearl Layered Necklace', 'Necklaces', 2199, 5], ['Antique Choker Necklace', 'Necklaces', 2499, 4],
  ['Antique Gold-Plated Jhumka', 'Earrings', 899, 14], ['Pearl Drop Earrings', 'Earrings', 549, 12],
  ['Polki Stud Earrings', 'Earrings', 1299, 7], ['Chandbali Earrings', 'Earrings', 1499, 6],
  ['Oxidised Silver Hoops', 'Earrings', 449, 11], ['Kundan Ear Cuffs', 'Earrings', 799, 3],
  ['Glass Bangles Set of 12', 'Bangles', 399, 13], ['Gold-Plated Kada Bangle', 'Bangles', 1799, 6],
  ['Bridal Bangle Set of 24', 'Bangles', 2999, 3], ['Lac Bangles Pair', 'Bangles', 349, 8],
  ['Oxidised Silver Anklet (Pair)', 'Anklets', 649, 9], ['Gold-Plated Payal', 'Anklets', 999, 5],
  ['Bridal Choker Set', 'Bridal Sets', 5999, 4], ['Temple Bridal Necklace Set', 'Bridal Sets', 8499, 2],
  ['Diamond-Look Bridal Haram', 'Bridal Sets', 7499, 2], ['Wedding Maang Tikka', 'Bridal Sets', 1599, 4],
  ['Adjustable Ruby Ring', 'Rings', 1099, 5], ['Emerald-Look Cocktail Ring', 'Rings', 1399, 3],
  ['Couple Band Rings', 'Rings', 899, 2], ['Mangalsutra Short Chain', 'Mangalsutra', 2299, 7],
  ['Black Bead Mangalsutra Long', 'Mangalsutra', 2599, 4], ['Waist Belt Oddiyanam', 'Waist Belts', 3999, 1],
  ['Hair Jada Billai', 'Hair Accessories', 1199, 2], ['Nose Pin Set of 3', 'Nose Pins', 299, 6],
  ['Gold-Plated Toe Rings Pair', 'Toe Rings', 249, 5], ['Kids Bracelet Set', 'Kids', 499, 1],
].slice(0, N_PRODUCTS);

// ---------- people and places ----------
const female = ['Priya', 'Divya', 'Lakshmi', 'Meena', 'Kavitha', 'Anitha', 'Swathi', 'Deepa', 'Nandhini', 'Revathi', 'Sangeetha', 'Pooja', 'Ananya', 'Shruti', 'Aishwarya', 'Harini', 'Vaishnavi', 'Keerthana', 'Janani', 'Mythili', 'Neha', 'Riya', 'Sneha', 'Aarthi', 'Bhavani', 'Gayathri', 'Nithya', 'Sowmya'];
const male = ['Karthik', 'Arun', 'Vignesh', 'Suresh', 'Rajesh', 'Dinesh', 'Ganesh', 'Prakash', 'Senthil', 'Balaji', 'Vivek', 'Rahul', 'Aditya', 'Manoj', 'Naveen', 'Sathish', 'Harish', 'Ramesh', 'Gokul', 'Hari'];
const surnamesSouth = ['Subramanian', 'Krishnan', 'Raman', 'Iyer', 'Natarajan', 'Venkatesan', 'Murugan', 'Selvam', 'Rajan', 'Pillai', 'Nair', 'Reddy', 'Naidu', 'Chandran', 'Sundaram', 'Narayanan', 'Balasubramanian', 'Kumar', 'Ramachandran', 'Srinivasan'];
const surnamesNorth = ['Sharma', 'Gupta', 'Verma', 'Singh', 'Agarwal', 'Mehta', 'Patel', 'Joshi', 'Kapoor', 'Malhotra', 'Bose', 'Banerjee', 'Das', 'Shah', 'Desai'];
const cities = [
  ['Chennai', 'TN', '600', 14], ['Coimbatore', 'TN', '641', 9], ['Madurai', 'TN', '625', 7], ['Tiruchirappalli', 'TN', '620', 5],
  ['Salem', 'TN', '636', 3], ['Tirunelveli', 'TN', '627', 3], ['Bengaluru', 'KA', '560', 10], ['Hyderabad', 'TG', '500', 7],
  ['Kochi', 'KL', '682', 4], ['Thiruvananthapuram', 'KL', '695', 3], ['Mumbai', 'MH', '400', 8], ['Pune', 'MH', '411', 4],
  ['New Delhi', 'DL', '110', 6], ['Gurugram', 'HR', '122', 2], ['Kolkata', 'WB', '700', 3], ['Ahmedabad', 'GJ', '380', 3],
  ['Jaipur', 'RJ', '302', 2], ['Lucknow', 'UP', '226', 2],
];
const streets = ['Gandhi Road', 'Anna Salai', 'Nehru Street', 'Temple Street', 'MG Road', 'Park Avenue', 'Lake View Road', 'Raja Street', 'Market Road', 'Station Road', 'Kamarajar Salai', 'Cross Street'];
const areas = ['Anna Nagar', 'T Nagar', 'RS Puram', 'Adyar', 'Indiranagar', 'Jubilee Hills', 'Koramangala', 'Velachery', 'Gandhipuram', 'Banjara Hills', 'Salt Lake', 'Andheri West', 'Vyttila', 'Satellite'];

function emailBase() {
  const base = String(args.email ?? process.env.SEED_EMAIL_BASE ?? 'yourname@example.com');
  const at = base.lastIndexOf('@');
  return at > 0 ? [base.slice(0, at).split('+')[0], base.slice(at + 1)] : ['yourname', 'example.com'];
}

function makeCustomers() {
  const out = [];
  const seen = new Set();
  while (out.length < N_CUSTOMERS) {
    const isFemale = rnd() < 0.78;
    const first = pick(isFemale ? female : male);
    const city = weighted(cities.map((c) => [c, c[3]]));
    const pool = ['TN', 'KA', 'TG', 'KL'].includes(city[1]) ? surnamesSouth : [...surnamesSouth, ...surnamesNorth];
    const last = pick(isFemale && rnd() < 0.2 ? [...pool, 'Devi'] : pool);
    const [user, domain] = emailBase();
    const handle = `${user}+${slug(first)}.${slug(last)}${out.length}`; // index keeps every email unique
    if (seen.has(handle)) continue;
    seen.add(handle);
    const [cityName, province, prefix] = city;
    out.push({
      first, last, email: `${handle}@${domain}`,
      phone: `+91${pick(['6', '7', '8', '9'])}${String(int(0, 999999999)).padStart(9, '0')}`,
      address: {
        address1: `${int(1, 240)}, ${pick(streets)}`, address2: pick(areas), city: cityName, provinceCode: province,
        zip: `${prefix}${String(int(1, 99)).padStart(3, '0')}`, countryCode: 'IN',
      },
    });
  }
  return out;
}

// ---------- orders ----------
function makeOrders(customers, catalog) {
  // Repeat buyers: every customer orders at least once, the rest go to a skewed few.
  const weights = customers.map((_, i) => 1 / Math.pow(i + 1, 0.4));
  const shuffled = customers.map((c, i) => ({ c, w: weights[i] })).sort(() => rnd() - 0.5);
  const orders = [];
  for (let i = 0; i < N_ORDERS; i++) {
    const customer = i < customers.length ? shuffled[i].c : weighted(shuffled.map((s) => [s.c, s.w]));
    const lines = [];
    const used = new Set();
    for (let n = weighted([[1, 45], [2, 32], [3, 17], [4, 6]]); n > 0; n--) {
      const item = weighted(catalog.map((p) => [p, p.weight]));
      if (used.has(item.title)) continue;
      used.add(item.title);
      lines.push({ ...item, quantity: weighted([[1, 78], [2, 17], [3, 5]]) });
    }
    const subtotal = lines.reduce((s, l) => s + l.price * l.quantity, 0);
    const shipping = subtotal >= 999 ? 0 : 60;
    const daysAgo = Math.floor(DAYS * Math.pow(rnd(), 1.3)); // more recent orders than old ones
    const placed = new Date(Date.now() - daysAgo * 86400000 - int(0, 14) * 3600000 - int(0, 59) * 60000);
    const cod = rnd() < 0.14;
    const fulfilled = daysAgo > 4 ? rnd() < 0.9 : rnd() < 0.3;
    let refund = null; // returns and refunds on delivered orders
    if (fulfilled && daysAgo > 9 && !cod && rnd() < 0.09) {
      const partial = rnd() < 0.6 && lines.length > 1;
      refund = partial
        ? { kind: 'partial', amount: lines[0].price * lines[0].quantity, reason: pick(['size_issue', 'color_mismatch', 'damaged']) }
        : { kind: 'full', amount: subtotal + shipping, reason: pick(['changed_mind', 'quality_issue', 'late_delivery']) };
    }
    orders.push({ customer, lines, subtotal, shipping, total: subtotal + shipping, placed, cod, fulfilled, refund });
  }
  return orders.sort((a, b) => a.placed - b.placed);
}

const money = (n) => ({ shopMoney: { amount: Number(n).toFixed(2), currencyCode: 'INR' } });

function toShopifyOrder(o, customerId) {
  const financialStatus = o.cod ? 'PENDING' : o.refund ? (o.refund.kind === 'full' ? 'REFUNDED' : 'PARTIALLY_REFUNDED') : 'PAID';
  const transactions = o.cod ? [] : [{ kind: 'SALE', status: 'SUCCESS', gateway: 'manual', amountSet: money(o.total) }];
  if (o.refund) transactions.push({ kind: 'REFUND', status: 'SUCCESS', gateway: 'manual', amountSet: money(o.refund.amount) });
  const address = { firstName: o.customer.first, lastName: o.customer.last, phone: o.customer.phone, ...o.customer.address };
  return {
    currency: 'INR', email: o.customer.email, processedAt: o.placed.toISOString(),
    tags: [BATCH, o.cod ? 'COD' : 'Prepaid', ...(o.refund ? [`refund-${o.refund.kind}`, `return-${o.refund.reason}`] : [])],
    note: 'Demo data for AI-agent testing',
    financialStatus,
    ...(o.fulfilled ? { fulfillmentStatus: 'FULFILLED' } : {}),
    customer: { toAssociate: { id: customerId } },
    shippingAddress: address, billingAddress: address,
    lineItems: o.lines.map((l) => ({
      ...(l.variantId ? { variantId: l.variantId } : { title: l.title }),
      quantity: l.quantity, priceSet: money(l.price), requiresShipping: true,
    })),
    shippingLines: [{ title: o.shipping ? 'Standard shipping' : 'Free shipping', code: 'standard', priceSet: money(o.shipping) }],
    transactions,
  };
}

// ---------- preview ----------
function preview() {
  const catalog = CATALOG.map(([title, category, price, weight]) => ({ title, category, price, weight }));
  const customers = makeCustomers();
  const orders = makeOrders(customers, catalog);
  const byCustomer = new Map();
  for (const o of orders) byCustomer.set(o.customer.email, (byCustomer.get(o.customer.email) ?? 0) + 1);
  const repeat = [...byCustomer.values()].filter((n) => n > 1).length;
  const sold = new Map();
  for (const o of orders) for (const l of o.lines) sold.set(l.title, (sold.get(l.title) ?? 0) + l.quantity);
  const ranked = [...sold.entries()].sort((a, b) => b[1] - a[1]);
  const revenue = orders.reduce((s, o) => s + o.total, 0);
  const inr = (n) => `Rs ${Math.round(n).toLocaleString('en-IN')}`;
  console.log('PREVIEW only. Nothing was sent to Shopify.\n');
  console.log(`Products ${catalog.length} | Customers ${customers.length} | Orders ${orders.length} (${orders[0].placed.toISOString().slice(0, 10)} to ${orders.at(-1).placed.toISOString().slice(0, 10)})`);
  console.log(`Revenue ${inr(revenue)}, average order ${inr(revenue / orders.length)}, line items ${orders.reduce((s, o) => s + o.lines.length, 0)}`);
  console.log(`Repeat buyers ${repeat} of ${byCustomer.size} customers who ordered; most orders by one customer: ${Math.max(...byCustomer.values())}`);
  console.log(`Fulfilled ${orders.filter((o) => o.fulfilled).length}, unfulfilled ${orders.filter((o) => !o.fulfilled).length}, COD pending ${orders.filter((o) => o.cod).length}`);
  console.log(`Refunds: ${orders.filter((o) => o.refund?.kind === 'full').length} full, ${orders.filter((o) => o.refund?.kind === 'partial').length} partial`);
  console.log(`Top sellers: ${ranked.slice(0, 3).map(([t, n]) => `${t} (${n})`).join('; ')}`);
  console.log(`Slow movers: ${ranked.slice(-3).map(([t, n]) => `${t} (${n})`).join('; ')}`);
  console.log(`Never sold: ${catalog.filter((p) => !sold.has(p.title)).map((p) => p.title).join('; ') || 'none'}`);
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

let domain; let token;
async function gql(query, variables) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401 || res.status === 403) throw new Error(`Shopify rejected the token (HTTP ${res.status}). Check the token and its scopes.`);
    const body = await res.json().catch(() => ({}));
    if (res.status === 429 || body.errors?.some((e) => e.extensions?.code === 'THROTTLED')) { await sleep(2000 * (attempt + 1)); continue; }
    if (body.errors) throw new Error(`GraphQL error: ${JSON.stringify(body.errors)}`);
    return body.data;
  }
  throw new Error('Still throttled after several retries; try again later.');
}
const fail = (what, errors) => { throw new Error(`${what} failed, stopping. ${JSON.stringify(errors)}`); };

async function ensureProducts() {
  const found = await gql(`query($q: String!) { products(first: 100, query: $q) { nodes { id title variants(first: 1) { nodes { id price } } } } }`, { q: `tag:${BATCH}` });
  const have = new Map(found.products.nodes.map((p) => [p.title, { variantId: p.variants.nodes[0].id, price: Number(p.variants.nodes[0].price) }]));
  const catalog = [];
  for (const [title, category, price, weight] of CATALOG) {
    let v = have.get(title);
    if (!v) {
      const created = await gql(`mutation($p: ProductCreateInput!) { productCreate(product: $p) { product { id variants(first: 1) { nodes { id } } } userErrors { field message } } }`, {
        p: { title, productType: category, vendor: 'Paavai Jewellers', status: 'ACTIVE', tags: [BATCH, category], descriptionHtml: `<p>${title}. Demo product for AI-agent testing.</p>` },
      });
      const r = created.productCreate;
      if (r.userErrors.length) fail(`Product "${title}"`, r.userErrors);
      const upd = await gql(`mutation($id: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $id, variants: $v) { productVariants { id price } userErrors { field message } } }`, {
        id: r.product.id, v: [{ id: r.product.variants.nodes[0].id, price: price.toFixed(2) }],
      });
      if (upd.productVariantsBulkUpdate.userErrors.length) fail(`Price for "${title}"`, upd.productVariantsBulkUpdate.userErrors);
      v = { variantId: r.product.variants.nodes[0].id, price };
      console.log(`product  ${title}  Rs ${price}`);
    }
    catalog.push({ title, category, price: v.price, weight, variantId: v.variantId });
  }
  return catalog;
}

async function ensureCustomers() {
  const people = makeCustomers();
  const have = new Map();
  let after = null;
  for (;;) {
    const d = await gql(`query($q: String!, $after: String) { customers(first: 250, query: $q, after: $after) { nodes { id email } pageInfo { hasNextPage endCursor } } }`, { q: `tag:${BATCH}`, after });
    for (const c of d.customers.nodes) have.set(c.email?.toLowerCase(), c.id);
    if (!d.customers.pageInfo.hasNextPage) break;
    after = d.customers.pageInfo.endCursor;
  }
  let made = 0;
  for (const p of people) {
    let id = have.get(p.email.toLowerCase());
    if (!id) {
      const d = await gql(`mutation($i: CustomerInput!) { customerCreate(input: $i) { customer { id } userErrors { field message } } }`, {
        i: { firstName: p.first, lastName: p.last, email: p.email, phone: p.phone, tags: [BATCH], addresses: [{ ...p.address, firstName: p.first, lastName: p.last }] },
      });
      if (d.customerCreate.userErrors.length) fail(`Customer ${p.email}`, d.customerCreate.userErrors);
      id = d.customerCreate.customer.id;
      if (++made % 20 === 0) console.log(`customers created: ${made}`);
      await sleep(300);
    }
    p.id = id;
  }
  console.log(`customers ready: ${people.length} (${made} new)`);
  return people;
}

const CREATE = `mutation($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
  orderCreate(order: $order, options: $options) {
    order { id name processedAt totalPriceSet { shopMoney { amount } } }
    userErrors { field message }
  }
}`;

async function createOrders(customers, catalog) {
  const orders = makeOrders(customers, catalog);
  const done = await gql(`query($q: String!) { ordersCount(query: $q) { count } }`, { q: `tag:${BATCH}` });
  const skip = done.ordersCount.count;
  if (skip) console.log(`${skip} orders already exist for batch "${BATCH}"; continuing from order ${skip + 1}.`);
  const created = [];
  for (let i = skip; i < orders.length; i++) {
    const o = orders[i];
    let result;
    for (let attempt = 0; attempt < 8; attempt++) {
      const data = await gql(CREATE, {
        order: toShopifyOrder(o, o.customer.id),
        options: { inventoryBehaviour: 'BYPASS', sendReceipt: false, sendFulfillmentReceipt: false },
      });
      result = data.orderCreate;
      const slow = result.userErrors.some((e) => /throttl|too many|rate|limit/i.test(e.message));
      if (!slow) break;
      console.log('Shopify says slow down; waiting 60s...');
      await sleep(60000);
    }
    if (result.userErrors.length) fail(`Order ${i + 1}`, result.userErrors);
    created.push(result.order.id);
    console.log(`order ${String(i + 1).padStart(3)}/${orders.length}  ${result.order.name}  ${result.order.processedAt.slice(0, 10)}  Rs ${result.order.totalPriceSet.shopMoney.amount}${o.refund ? `  (${o.refund.kind} refund)` : ''}`);
    await sleep(PACE_MS);
  }
  return created;
}

// ---------- CSV for Shopify's own customer importer (no token, no network) ----------
function writeCustomersCsv() {
  const header = ['First Name', 'Last Name', 'Email', 'Accepts Email Marketing', 'Default Address Company', 'Default Address Address1', 'Default Address Address2', 'Default Address City', 'Default Address Province Code', 'Default Address Country Code', 'Default Address Zip', 'Default Address Phone', 'Phone', 'Accepts SMS Marketing', 'Tags', 'Note', 'Tax Exempt'];
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = makeCustomers().map((c) => [c.first, c.last, c.email, 'no', '', c.address.address1, c.address.address2, c.address.city, c.address.provinceCode, 'IN', c.address.zip, c.phone, c.phone, 'no', BATCH, 'Demo customer for AI-agent testing', 'no']);
  const file = join(root, 'integrations', 'out', 'customers.csv');
  mkdirSync(join(root, 'integrations', 'out'), { recursive: true });
  writeFileSync(file, [header, ...rows].map((r) => r.map(q).join(',')).join('\r\n'), 'utf8');
  console.log(`Wrote ${rows.length} customers to ${file}\nIn Shopify: Customers -> Import -> choose this file.`);
}

// ---------- main ----------
if (args.csv === true) {
  writeCustomersCsv();
} else if (!LIVE) {
  preview();
} else {
  loadEnv();
  token = process.env.SHOPIFY_ADMIN_API_TOKEN;
  domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain) throw new Error('Set SHOPIFY_STORE_DOMAIN in .env to your development store, e.g. my-dev-store.myshopify.com');
  if (domain === LIVE_STORE) throw new Error(`${LIVE_STORE} is your real store. This script is for a development store only.`);
  // Dev Dashboard apps have a Client ID and Client secret instead of a revealed token.
  // Exchange them for a short-lived (about 24h) Admin API token.
  if (!token && process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET) {
    const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.SHOPIFY_CLIENT_ID, client_secret: process.env.SHOPIFY_CLIENT_SECRET }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) throw new Error(`Could not exchange the Client ID and secret for a token (HTTP ${res.status}). Is the app installed on ${domain}, and does it have the scopes?`);
    token = body.access_token;
  }
  if (!token) throw new Error('Put SHOPIFY_ADMIN_API_TOKEN, or SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET, in .env');
  if (domain === LIVE_STORE) throw new Error(`${LIVE_STORE} is your real store. This script is for a development store only.`);
  if (!args.email && !process.env.SEED_EMAIL_BASE) throw new Error('Set SEED_EMAIL_BASE in .env (or pass --email=) so customers use your own inbox.');
  if (args['confirm-store'] !== domain) throw new Error(`Add --confirm-store=${domain} to confirm the target store.`);

  // --only=customers creates just the customers (no products, no orders).
  if (args.only === 'customers') {
    const customers = await ensureCustomers();
    console.log(`\nDone. ${customers.length} customers in ${domain}, batch "${BATCH}".`);
    process.exit(0);
  }
  const catalog = await ensureProducts();
  const customers = await ensureCustomers();
  const created = await createOrders(customers, catalog);
  mkdirSync(join(root, 'integrations', 'out'), { recursive: true });
  writeFileSync(join(root, 'integrations', 'out', 'dev-store-orders.json'), JSON.stringify(created, null, 2));
  console.log(`\nDone. ${catalog.length} products, ${customers.length} customers, ${created.length} new orders in ${domain}, batch "${BATCH}".`);
}
