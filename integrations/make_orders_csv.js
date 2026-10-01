#!/usr/bin/env node
/**
 * Generates 150 demo orders as a CSV in the SAME format as Shopify's own orders export, linked to the
 * 100 customers in integrations/out/customers.csv, using the products and prices found in your
 * existing export. Nothing is sent to Shopify: this only writes a file.
 *
 *   node integrations/make_orders_csv.js
 *   node integrations/make_orders_csv.js --export="C:\Users\jeyas\Downloads\orders_export_1.csv" --orders=150 --days=30
 *
 * Output: integrations/out/orders_import.csv
 *
 * Shopify's admin has no built-in "import orders" button. Import this file with an importer app
 * (for example Matrixify), or use scripts/seed-test-orders.mjs / integrations/seed_dev_store.js
 * which create orders through the Admin API.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : true];
  }),
);
const EXPORT = String(args.export ?? 'C:\\Users\\jeyas\\Downloads\\orders_export_1.csv');
const COUNT = Number(args.orders ?? 150);
const DAYS = Number(args.days ?? 30);
const SEED = Number(args.seed ?? 20261002);
const BATCH = String(args.batch ?? 'demo-2026-10');

// ---------- small CSV reader/writer (handles quotes and embedded commas) ----------
function parseCsv(text) {
  const rows = [];
  let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows;
}
const toObjects = (rows) => rows.slice(1).filter((r) => r.length > 1).map((r) => Object.fromEntries(rows[0].map((h, i) => [h, r[i] ?? ''])));
const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

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

// ---------- read the existing export: header, products, last order number ----------
const exportRows = parseCsv(readFileSync(EXPORT, 'utf8').replace(/^\uFEFF/, ''));
const header = exportRows[0];
const existing = toObjects(exportRows);
const catalog = new Map();
for (const r of existing) {
  const price = Number(r['Lineitem price']);
  if (r['Lineitem name'] && price > 0) catalog.set(r['Lineitem name'], price);
}
const products = [...catalog.entries()].map(([name, price]) => ({ name, price, w: 1 + Math.floor(rnd() * 9) }));
const lastNo = Math.max(...existing.map((r) => Number(r.Name.replace('#', ''))).filter(Number.isFinite));

// ---------- customers (from the customers CSV made earlier) ----------
const custRows = toObjects(parseCsv(readFileSync(join(root, 'integrations', 'out', 'customers.csv'), 'utf8')));
if (!custRows.length) throw new Error('integrations/out/customers.csv is empty. Run: node integrations/seed_dev_store.js --csv --customers=100 --email=you@gmail.com');
const provinceName = { TN: 'Tamil Nadu', KA: 'Karnataka', TG: 'Telangana', KL: 'Kerala', MH: 'Maharashtra', DL: 'Delhi', HR: 'Haryana', WB: 'West Bengal', GJ: 'Gujarat', RJ: 'Rajasthan', UP: 'Uttar Pradesh' };

const pad = (n) => String(n).padStart(2, '0');
// Shopify exports use "2026-09-05 10:57:08 +0530" (India time).
const ist = (d) => {
  const t = new Date(d.getTime() + 5.5 * 3600000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())} +0530`;
};
const money = (n) => n.toFixed(2);

// ---------- build orders ----------
const weights = custRows.map((_, i) => 1 / Math.pow(i + 1, 0.4));
const shuffled = custRows.map((c, i) => ({ c, w: weights[i] })).sort(() => rnd() - 0.5);
const orders = [];
for (let i = 0; i < COUNT; i++) {
  const cust = i < custRows.length ? shuffled[i].c : weighted(shuffled.map((s) => [s.c, s.w]));
  const lines = [];
  const used = new Set();
  for (let n = weighted([[1, 78], [2, 18], [3, 4]]); n > 0; n--) {
    const p = weighted(products.map((x) => [x, x.w]));
    if (used.has(p.name)) continue;
    used.add(p.name);
    lines.push({ ...p, qty: weighted([[1, 94], [2, 6]]) });
  }
  const daysAgo = DAYS * Math.pow(rnd(), 1.2);
  const created = new Date(Date.now() - daysAgo * 86400000);
  const cod = rnd() < 0.15;
  const fulfilled = daysAgo > 4 ? rnd() < 0.8 : rnd() < 0.15;
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  let refunded = 0;
  if (!cod && fulfilled && daysAgo > 9 && rnd() < 0.06) refunded = rnd() < 0.6 ? lines[0].price * lines[0].qty : subtotal;
  orders.push({ cust, lines, created, cod, fulfilled, subtotal, refunded });
}
orders.sort((a, b) => a.created - b.created);

// ---------- rows in the export's own column order ----------
const rows = [];
orders.forEach((o, idx) => {
  const name = `#${lastNo + 1 + idx}`;
  const c = o.cust;
  const total = o.subtotal;
  const tax = (total * 0.18) / 1.18;
  const province = c['Default Address Province Code'];
  const intra = province === 'TN'; // same state as the store: CGST + SGST, otherwise IGST
  const fullName = `${c['First Name']} ${c['Last Name']}`;
  const status = o.cod ? 'pending' : o.refunded ? (o.refunded >= total ? 'refunded' : 'partially_refunded') : 'paid';
  const createdAt = ist(o.created);
  const paidAt = o.cod ? '' : ist(new Date(o.created.getTime() + int(20, 600) * 1000));
  const fulfilledAt = o.fulfilled ? ist(new Date(o.created.getTime() + int(1, 4) * 86400000 + int(0, 8) * 3600000)) : '';
  const lineStatus = o.fulfilled ? 'fulfilled' : 'pending';
  const base = (extra) => Object.fromEntries(header.map((h) => [h, extra[h] ?? '']));

  o.lines.forEach((l, li) => {
    if (li > 0) {
      rows.push(base({
        Name: name, Email: c.Email, 'Created at': createdAt, 'Lineitem quantity': l.qty, 'Lineitem name': l.name, 'Lineitem price': money(l.price),
        'Lineitem requires shipping': 'true', 'Lineitem taxable': 'true', 'Lineitem fulfillment status': lineStatus, Vendor: 'Paavai Jewellers', 'Lineitem discount': '0.00',
      }));
      return;
    }
    rows.push(base({
      Name: name, Email: c.Email, 'Financial Status': status, 'Paid at': paidAt, 'Fulfillment Status': o.fulfilled ? 'fulfilled' : 'unfulfilled',
      'Fulfilled at': fulfilledAt, 'Accepts Marketing': 'no', Currency: 'INR', Subtotal: money(o.subtotal), Shipping: '0.00', Taxes: money(tax), Total: money(total),
      'Discount Amount': '0.00', 'Shipping Method': 'Standard', 'Created at': createdAt,
      'Lineitem quantity': l.qty, 'Lineitem name': l.name, 'Lineitem price': money(l.price), 'Lineitem requires shipping': 'true', 'Lineitem taxable': 'true', 'Lineitem fulfillment status': lineStatus,
      'Billing Name': fullName, 'Billing Street': c['Default Address Address1'], 'Billing Address1': c['Default Address Address1'], 'Billing Address2': c['Default Address Address2'],
      'Billing City': c['Default Address City'], 'Billing Zip': c['Default Address Zip'], 'Billing Province': province, 'Billing Country': 'IN', 'Billing Phone': c.Phone,
      'Shipping Name': fullName, 'Shipping Street': c['Default Address Address1'], 'Shipping Address1': c['Default Address Address1'], 'Shipping Address2': c['Default Address Address2'],
      'Shipping City': c['Default Address City'], 'Shipping Zip': c['Default Address Zip'], 'Shipping Province': province, 'Shipping Country': 'IN', 'Shipping Phone': c.Phone,
      Notes: '', 'Payment Method': o.cod ? 'Cash on Delivery (COD)' : 'manual', 'Payment Reference': `${name}.1`, 'Refunded Amount': money(o.refunded),
      Vendor: 'Paavai Jewellers', 'Outstanding Balance': o.cod ? money(total) : '0.00', Tags: `dummy-data, ${BATCH}${o.refunded ? ', returned' : ''}`, 'Risk Level': 'Low', Source: 'web', 'Lineitem discount': '0.00',
      'Tax 1 Name': intra ? 'CGST 9%' : 'IGST 18%', 'Tax 1 Value': money(intra ? tax / 2 : tax), 'Tax 2 Name': intra ? 'SGST 9%' : '', 'Tax 2 Value': intra ? money(tax / 2) : '',
      Phone: c.Phone, 'Billing Province Name': provinceName[province] ?? '', 'Shipping Province Name': provinceName[province] ?? '',
    }));
  });
});

mkdirSync(join(root, 'integrations', 'out'), { recursive: true });
const file = join(root, 'integrations', 'out', 'orders_import.csv');
writeFileSync(file, '\uFEFF' + [header, ...rows.map((r) => header.map((h) => r[h]))].map((r) => r.map(quote).join(',')).join('\r\n'), 'utf8');

// ---------- the same orders in Matrixify's own column names ----------
// Matrixify does not read Shopify's export columns: it wants "Line: ..." rows and "Shipping: ..." fields.
{
  const mHeader = ['Name', 'Command', 'Send Receipt', 'Inventory Behaviour', 'Processed At', 'Created At', 'Currency', 'Email', 'Tags', 'Note', 'Source',
    'Financial Status', 'Fulfillment Status', 'Tax: Included',
    'Customer: Email', 'Customer: First Name', 'Customer: Last Name', 'Customer: Phone',
    'Shipping: First Name', 'Shipping: Last Name', 'Shipping: Address 1', 'Shipping: Address 2', 'Shipping: City', 'Shipping: Province Code', 'Shipping: Zip', 'Shipping: Country Code', 'Shipping: Phone',
    'Billing: First Name', 'Billing: Last Name', 'Billing: Address 1', 'Billing: Address 2', 'Billing: City', 'Billing: Province Code', 'Billing: Zip', 'Billing: Country Code', 'Billing: Phone',
    'Line: Type', 'Line: Title', 'Line: Quantity', 'Line: Price', 'Line: Requires Shipping', 'Line: Taxable', 'Line: Fulfillment Status',
    'Transaction: Kind', 'Transaction: Status', 'Transaction: Amount', 'Transaction: Gateway'];
  const mRows = [];
  orders.forEach((o, idx) => {
    const name = `#${lastNo + 1 + idx}`;
    const c = o.cust;
    const total = o.subtotal;
    const status = o.cod ? 'pending' : o.refunded ? (o.refunded >= total ? 'refunded' : 'partially_refunded') : 'paid';
    const iso = o.created.toISOString();
    const addr = (p) => ({
      [`${p}: First Name`]: c['First Name'], [`${p}: Last Name`]: c['Last Name'], [`${p}: Address 1`]: c['Default Address Address1'], [`${p}: Address 2`]: c['Default Address Address2'],
      [`${p}: City`]: c['Default Address City'], [`${p}: Province Code`]: c['Default Address Province Code'], [`${p}: Zip`]: c['Default Address Zip'], [`${p}: Country Code`]: 'IN', [`${p}: Phone`]: c.Phone,
    });
    const row = (extra) => Object.fromEntries(mHeader.map((h) => [h, extra[h] ?? '']));
    o.lines.forEach((l, li) => {
      const line = { 'Line: Type': 'Line Item', 'Line: Title': l.name, 'Line: Quantity': l.qty, 'Line: Price': money(l.price), 'Line: Requires Shipping': 'TRUE', 'Line: Taxable': 'TRUE', 'Line: Fulfillment Status': o.fulfilled ? 'fulfilled' : '' };
      mRows.push(row(li === 0 ? {
        Name: name, Command: 'NEW', 'Send Receipt': 'FALSE', 'Inventory Behaviour': 'bypass', 'Processed At': iso, 'Created At': iso, Currency: 'INR', Email: c.Email, Tags: `dummy-data, ${BATCH}${o.refunded ? ', returned' : ''}`,
        Note: 'Demo order for AI-agent testing', Source: 'web', 'Financial Status': status, 'Fulfillment Status': o.fulfilled ? 'fulfilled' : '', 'Tax: Included': 'TRUE',
        'Customer: Email': c.Email, 'Customer: First Name': c['First Name'], 'Customer: Last Name': c['Last Name'], 'Customer: Phone': c.Phone, ...addr('Shipping'), ...addr('Billing'), ...line,
      } : { Name: name, ...line }));
    });
    if (!o.cod) mRows.push(row({ Name: name, 'Transaction: Kind': 'sale', 'Transaction: Status': 'success', 'Transaction: Amount': money(total), 'Transaction: Gateway': 'manual' }));
    if (o.refunded) mRows.push(row({ Name: name, 'Transaction: Kind': 'refund', 'Transaction: Status': 'success', 'Transaction: Amount': money(o.refunded), 'Transaction: Gateway': 'manual' }));
  });
  const mFile = join(root, 'integrations', 'out', 'orders_matrixify.csv');
  writeFileSync(mFile, '﻿' + [mHeader, ...mRows.map((r) => mHeader.map((h) => r[h]))].map((r) => r.map(quote).join(',')).join('\r\n'), 'utf8');
  console.log(`Wrote Matrixify format (${mRows.length} rows) to ${mFile}`);
}

const revenue = orders.reduce((s, o) => s + o.subtotal, 0);
const inr = (n) => `Rs ${Math.round(n).toLocaleString('en-IN')}`;
console.log(`Wrote ${orders.length} orders (${rows.length} rows) to ${file}`);
console.log(`Numbers ${rows[0].Name} to ${rows.at(-1).Name}, ${orders[0].created.toISOString().slice(0, 10)} to ${orders.at(-1).created.toISOString().slice(0, 10)}`);
console.log(`Products ${products.length}, customers used ${new Set(orders.map((o) => o.cust.Email)).size} of ${custRows.length}, revenue ${inr(revenue)}`);
console.log(`Paid ${orders.filter((o) => !o.cod && !o.refunded).length}, COD pending ${orders.filter((o) => o.cod).length}, refunded ${orders.filter((o) => o.refunded).length}, fulfilled ${orders.filter((o) => o.fulfilled).length}`);
