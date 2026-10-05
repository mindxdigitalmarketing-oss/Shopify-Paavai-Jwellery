#!/usr/bin/env python3
"""
Turns scripts/out/seed-preview.json (made by `node scripts/seed-rs1-orders.mjs`, preview mode)
into a Matrixify-format Excel file: scripts/out/rs1_orders_matrixify.xlsx

    node scripts/seed-rs1-orders.mjs
    python scripts/make-rs1-matrixify-xlsx.py

Nothing is sent to Shopify. Upload the .xlsx in Matrixify > Import.

Mix (1000 orders): exactly half fulfilled, and all four fulfilled/paid combinations:
  300 fulfilled + paid, 200 fulfilled + unpaid, 250 unfulfilled + paid, 250 unfulfilled + unpaid.
Sales channel (Source column + channel-* tag): website, amazon, flipkart, delhivery, instagram, whatsapp.
Orders are tagged TEST-DATA, no receipts are sent, customers use mindx.digitalmarketing+name@gmail.com.
"""
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from openpyxl import Workbook
from openpyxl.styles import Font

root = Path(__file__).resolve().parent.parent
orders = json.loads((root / "scripts/out/seed-preview.json").read_text(encoding="utf-8"))
FIRST_NUMBER = 2001  # store's latest order is around #1111, so these cannot collide

SKU = {
    "50598542213337": ("RS1 Daily Drink: Monthly Pack", "RS1-MONTHLY"),
    "50598542377177": ("RS1 Daily Drink: Travel Packs", "RS1-TRAVEL"),
    "50598542475481": ("RS1 Starter Bundle", "RS1-STARTER"),
    "50598542573785": ("RS1 Shaker Bottle", "RS1-SHAKER"),
    "50598542770393": ("RS1 Sample Pack", "RS1-SAMPLE"),
}

rng = random.Random(20261005)
COMBOS = [("fulfilled", "paid", 300), ("fulfilled", "unpaid", 200), ("unfulfilled", "paid", 250), ("unfulfilled", "unpaid", 250)]
assignment = [(f, p) for f, p, n in COMBOS for _ in range(n)]
assert len(assignment) == len(orders), f"expected {len(assignment)} orders, got {len(orders)}"
rng.shuffle(assignment)
CHANNELS = [("website", 35), ("amazon", 20), ("flipkart", 20), ("delhivery", 10), ("instagram", 8), ("whatsapp", 7)]
COURIER = {"amazon": "Amazon Logistics", "flipkart": "Ekart Logistics", "delhivery": "Delhivery"}
OTHER_COURIERS = ["Delhivery", "DTDC", "India Post", "Blue Dart"]

header = [
    "Name", "Command", "Send Receipt", "Inventory Behaviour", "Processed At", "Created At", "Currency", "Email", "Tags", "Note", "Source",
    "Financial Status", "Tax: Included",
    "Customer: Email", "Customer: First Name", "Customer: Last Name", "Customer: Phone",
    "Shipping: First Name", "Shipping: Last Name", "Shipping: Address 1", "Shipping: Address 2", "Shipping: City", "Shipping: Province Code", "Shipping: Zip", "Shipping: Country Code", "Shipping: Phone",
    "Billing: First Name", "Billing: Last Name", "Billing: Address 1", "Billing: Address 2", "Billing: City", "Billing: Province Code", "Billing: Zip", "Billing: Country Code", "Billing: Phone",
    "Line: Type", "Line: Title", "Line: SKU", "Line: Quantity", "Line: Price", "Line: Requires Shipping", "Line: Taxable", "Line: Fulfillment Status",
    "Shipping Line: Title", "Shipping Line: Price",
    "Transaction: Kind", "Transaction: Status", "Transaction: Amount", "Transaction: Gateway",
    "Fulfillment: Status", "Fulfillment: Processed At", "Fulfillment: Notify Customer", "Fulfillment: Tracking Company", "Fulfillment: Tracking Number",
]

wb = Workbook()
ws = wb.active
ws.title = "Orders"
ws.append(header)
for c in ws[1]:
    c.font = Font(bold=True)


def row(**kw):
    ws.append([kw.get(h, "") for h in header])


def addr(prefix, a):
    return {
        f"{prefix}: First Name": a["firstName"], f"{prefix}: Last Name": a["lastName"],
        f"{prefix}: Address 1": a["address1"], f"{prefix}: Address 2": a.get("address2", ""),
        f"{prefix}: City": a["city"], f"{prefix}: Province Code": a["provinceCode"], f"{prefix}: Zip": a["zip"],
        f"{prefix}: Country Code": a["countryCode"], f"{prefix}: Phone": a.get("phone", ""),
    }


def money(x):
    return x["priceSet"]["shopMoney"]["amount"]


summary = {}
now = datetime.now(timezone.utc)
for i, o in enumerate(orders):
    name = f"#{FIRST_NUMBER + i}"
    cu = o["customer"]["toUpsert"]
    f_state, p_state = assignment[i]
    fulfilled, paid = f_state == "fulfilled", p_state == "paid"
    channel = rng.choices([c for c, _ in CHANNELS], [w for _, w in CHANNELS])[0]
    summary[channel] = summary.get(channel, 0) + 1
    tags = ["TEST-DATA", "rs1-test-2026-10", f"channel-{channel}", "Prepaid" if paid else "Payment-Pending", f_state.capitalize()]
    ts = o["processedAt"]
    placed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    shipped = min(now - timedelta(minutes=5), placed + timedelta(days=rng.randint(1, 4), hours=rng.randint(0, 8)))
    courier = COURIER.get(channel) or rng.choice(OTHER_COURIERS)

    shipping = o["shippingLines"][0]
    total = sum(float(money(l)) * l["quantity"] for l in o["lineItems"]) + float(money(shipping))

    for li, l in enumerate(o["lineItems"]):
        title, sku = SKU[l["variantId"].rsplit("/", 1)[1]]
        line = {
            "Line: Type": "Line Item", "Line: Title": title, "Line: SKU": sku, "Line: Quantity": l["quantity"],
            "Line: Price": money(l), "Line: Requires Shipping": "TRUE", "Line: Taxable": "TRUE",
            "Line: Fulfillment Status": "fulfilled" if fulfilled else "",
        }
        if li == 0:
            row(**{
                "Name": name, "Command": "NEW", "Send Receipt": "FALSE", "Inventory Behaviour": "bypass",
                "Processed At": ts, "Created At": ts, "Currency": o["currency"], "Email": o["email"],
                "Tags": ", ".join(tags), "Note": f"Mock order for testing - channel: {channel}", "Source": channel,
                "Financial Status": "paid" if paid else "pending", "Tax: Included": "TRUE",
                "Customer: Email": cu["email"], "Customer: First Name": cu["firstName"], "Customer: Last Name": cu["lastName"], "Customer: Phone": cu["phone"],
                **addr("Shipping", o["shippingAddress"]), **addr("Billing", o["billingAddress"]), **line,
                "Shipping Line: Title": shipping["title"], "Shipping Line: Price": money(shipping),
            })
        else:
            row(Name=name, **line)
    if fulfilled:
        row(**{
            "Name": name, "Fulfillment: Status": "success", "Fulfillment: Processed At": shipped.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "Fulfillment: Notify Customer": "FALSE", "Fulfillment: Tracking Company": courier,
            "Fulfillment: Tracking Number": f"RS1{rng.randint(10**9, 10**10 - 1)}",
        })
    if paid:
        row(**{"Name": name, "Transaction: Kind": "sale", "Transaction: Status": "success", "Transaction: Amount": f"{total:.2f}", "Transaction: Gateway": "manual"})

ws.freeze_panes = "B2"
out = root / "scripts/out/rs1_orders_matrixify.xlsx"
wb.save(out)
print(f"Wrote {len(orders)} orders ({ws.max_row - 1} rows) to {out}")
print("Channels:", dict(sorted(summary.items(), key=lambda kv: -kv[1])))
