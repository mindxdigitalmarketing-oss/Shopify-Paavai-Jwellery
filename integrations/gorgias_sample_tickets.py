#!/usr/bin/env python3
"""
Creates sample support tickets in Gorgias from your Shopify orders export, so the AI agent has
realistic tickets to work on: real customer emails, real order numbers and real fulfilment states.

  python integrations/gorgias_sample_tickets.py --orders-csv "C:\\Users\\jeyas\\Downloads\\orders_export_real_emails_final.csv"
      -> DRY RUN: builds the tickets, writes integrations/out/gorgias_preview.json, sends nothing.

  python integrations/gorgias_sample_tickets.py --orders-csv <file> --live --confirm-real-emails
      -> creates the tickets in Gorgias (sequentially, ~2 per second).

Options
  --count 200               how many tickets (orders are reused if the file has fewer)
  --alias-base you@gmail.com   rewrite every customer email to you+<name>@gmail.com, for a safe test
                            that can never reach a real customer
  --batch sample-2026-10    tag added to every ticket so you can find and bulk-delete them
  --seed 7                  same seed -> same tickets

Needs in .env (or the environment):
  GORGIAS_DOMAIN=yourshop            (the part before .gorgias.com)
  GORGIAS_EMAIL=you@yourcompany.com  (the agent login that owns the API key)
  GORGIAS_API_KEY=...                (Gorgias -> Settings -> REST API)

READ THIS BEFORE --live WITH REAL EMAILS
  The tickets contain only the customer's own message (channel "api", from the customer), and no
  reply is sent, so the script itself emails nobody. But Gorgias can email customers on its own:
  auto-reply rules, "ticket created" macros/rules, and satisfaction (CSAT) surveys sent when a
  ticket is closed. Switch those off first (Settings -> Rules, Satisfaction surveys), or use
  --alias-base so any email goes to your own inbox.

Shipment/fulfilment mix: each ticket matches its order's real state (unfulfilled and late, in
transit, delivered, refunded, COD pending). The "source" of each order is Amazon, Delhivery,
Flipkart or Web: taken from the order's tags/notes when they name one, otherwise picked at random.
"""
import argparse
import csv
import json
import os
import random
import re
import sys
import time
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = ["Amazon", "Delhivery", "Flipkart", "Web"]
SOURCE_WEIGHTS = [20, 15, 25, 40]


def load_env():
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
        if m and m.group(1) not in os.environ:
            os.environ[m.group(1)] = m.group(2).strip("'\"")


def parse_dt(value):
    """Shopify exports look like '2026-09-05 10:57:08 +0530'."""
    for fmt in ("%Y-%m-%d %H:%M:%S %z", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S"):
        try:
            d = datetime.strptime(value.strip(), fmt)
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def read_orders(path):
    """One dict per order (the header row of each order in a Shopify orders export)."""
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    orders = []
    for r in rows:
        if not (r.get("Financial Status") or r.get("Total")):
            continue  # extra line-item rows
        email = (r.get("Email") or "").strip()
        if "@" not in email or r.get("Cancelled at"):
            continue
        orders.append(r)
    return orders


def pick_source(order, rng):
    text = " ".join(str(order.get(k, "")) for k in ("Tags", "Notes", "Note Attributes", "Source")).lower()
    for s in ("Amazon", "Flipkart", "Delhivery"):  # marketplaces/carrier named in the order
        if s.lower() in text:
            return s
    if "online store" in text:
        return "Web"
    # Shopify's own "Source" column just says "web" for nearly every order, so it is not
    # evidence of where the customer bought: pick a mix instead.
    return rng.choices(SOURCES, SOURCE_WEIGHTS)[0]


def origin_phrase(source):
    return {
        "Amazon": "I ordered on Amazon",
        "Flipkart": "I ordered on Flipkart",
        "Web": "I ordered on your website",
        "Delhivery": "My parcel was sent through Delhivery",
    }[source]


def build_ticket(order, source, rng, alias_base, batch, now):
    name = (order.get("Shipping Name") or order.get("Billing Name") or "").strip() or order["Email"].split("@")[0]
    first = name.split()[0]
    email = order["Email"].strip()
    if alias_base:
        user, _, host = alias_base.partition("@")
        handle = re.sub(r"[^a-z0-9]+", ".", name.lower()).strip(".") or "customer"
        email = f"{user.split('+')[0]}+{handle}@{host}"
    number = order["Name"].strip()
    city = (order.get("Shipping City") or "").strip()
    item = (order.get("Lineitem name") or "my order").strip()
    placed = parse_dt(order.get("Created at", "")) or now
    age = max(0.0, (now - placed).total_seconds() / 86400)
    fulfilled = (order.get("Fulfillment Status") or "").lower() == "fulfilled"
    paid = (order.get("Financial Status") or "").lower()
    refunded = paid in ("refunded", "partially_refunded") or float(order.get("Refunded Amount") or 0) > 0
    cod = "cash on delivery" in (order.get("Payment Method") or "").lower() or paid == "pending"
    via = origin_phrase(source)

    # (state, subject, body, closed?)
    if refunded:
        state = "refunded"
        subject = f"Refund status for order {number}"
        body = f"Hi, {via} and returned {item} (order {number}). I was told a refund is coming but I haven't seen it yet. Can you tell me when it will reach my account?"
        closed = rng.random() < 0.6
    elif fulfilled and age > 12:
        state = "delivered"
        scenario = rng.choice(["not_received", "damaged", "exchange"])
        if scenario == "not_received":
            subject, body = f"Order {number} shows delivered but I haven't got it", f"Hello, order {number} ({item}) is marked as delivered but nothing has arrived at my address in {city or 'my city'}. {via}. Please help me trace it."
        elif scenario == "damaged":
            subject, body = f"Damaged item in order {number}", f"Hi, {via}. The {item} in order {number} arrived with a damaged clasp. How can I get a replacement?"
        else:
            subject, body = f"Exchange request for order {number}", f"Hi, I'd like to exchange {item} from order {number} for a different design. {via}. What is the process?"
        closed = rng.random() < 0.7
    elif fulfilled:
        state = "in_transit"
        subject = f"Where is my order {number}?"
        body = f"Hi, {via} {int(age)} days ago (order {number}, {item}). It says shipped but the tracking hasn't moved. Where is my order, and when will it reach {city or 'me'}?"
        closed = rng.random() < 0.35
    elif cod:
        state = "cod_pending"
        subject = f"Confirm my cash on delivery order {number}"
        body = f"Hi, I placed order {number} ({item}) with cash on delivery. {via}. Can you confirm it, and can I pay online instead?"
        closed = rng.random() < 0.4
    elif age > 5:
        state = "unfulfilled_late"
        subject = f"Order {number} not shipped yet"
        body = f"Hello, it has been {int(age)} days since I ordered {item} (order {number}) and it still hasn't shipped. {via}. When will it be dispatched?"
        closed = rng.random() < 0.25
    else:
        state = "unfulfilled_new"
        subject = f"Change address or cancel order {number}"
        body = f"Hi, I just placed order {number} ({item}). {via}. Can I change the delivery address, or cancel it if it hasn't shipped?"
        closed = rng.random() < 0.5

    created = max(placed, now - (now - placed) / 2) if age > 1 else now
    ticket = {
        "customer": {"email": email, "name": name},
        "channel": "api",
        "via": "api",
        "status": "closed" if closed else "open",
        "subject": subject,
        "created_datetime": created.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "tags": [{"name": t} for t in ("sample-data", batch, f"source-{source.lower()}", f"state-{state.replace('_', '-')}")],
        "messages": [{
            "channel": "api",
            "via": "api",
            "from_agent": False,  # customer message only: nothing is sent to the customer
            "sender": {"email": email, "name": name},
            "subject": subject,
            "body_text": f"{body}\n\nThanks,\n{first}",
            "sent_datetime": created.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        }],
    }
    return ticket, {"order": number, "state": state, "source": source}


def post_ticket(session, base, ticket):
    for attempt in range(6):
        r = session.post(f"{base}/api/tickets", json=ticket, timeout=30)
        if r.status_code == 429:
            time.sleep(float(r.headers.get("Retry-After", 2 * (attempt + 1))))
            continue
        if r.status_code in (401, 403):
            sys.exit(f"Gorgias rejected the login (HTTP {r.status_code}). Check GORGIAS_EMAIL and GORGIAS_API_KEY.")
        if not r.ok:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:400]}")
        return r.json()
    raise RuntimeError("Still rate limited after several retries.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--orders-csv", required=True)
    ap.add_argument("--count", type=int, default=200)
    ap.add_argument("--alias-base")
    ap.add_argument("--batch", default="sample-2026-10")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--confirm-real-emails", action="store_true")
    a = ap.parse_args()

    rng = random.Random(a.seed)
    orders = read_orders(a.orders_csv)
    if not orders:
        sys.exit("No usable orders (with an email) found in that file.")
    now = datetime.now(timezone.utc)
    chosen = [orders[i % len(orders)] for i in range(a.count)] if len(orders) < a.count else rng.sample(orders, a.count)
    built = [build_ticket(o, pick_source(o, rng), rng, a.alias_base, a.batch, now) for o in chosen]

    emails = {t["customer"]["email"] for t, _ in built}
    by = lambda k: {x: sum(1 for _, m in built if m[k] == x) for x in sorted({m[k] for _, m in built})}
    print(f"{len(built)} tickets from {len(orders)} orders, {len(emails)} different customer emails")
    print("states:", by("state"))
    print("sources:", by("source"))
    print("status:", {s: sum(1 for t, _ in built if t["status"] == s) for s in ("open", "closed")})
    print("emails are", "ALIASES of " + a.alias_base if a.alias_base else "the REAL customer emails from the file")

    os.makedirs(os.path.join(ROOT, "integrations", "out"), exist_ok=True)
    preview = os.path.join(ROOT, "integrations", "out", "gorgias_preview.json")
    with open(preview, "w", encoding="utf-8") as f:
        json.dump([t for t, _ in built], f, indent=2, ensure_ascii=False)

    if not a.live:
        print(f"\nDRY RUN: nothing was sent. Full tickets are in {preview}")
        return

    if not a.alias_base and not a.confirm_real_emails:
        sys.exit("These tickets use real customer emails. Add --confirm-real-emails (after turning off Gorgias auto-replies "
                 "and satisfaction surveys), or use --alias-base you@gmail.com for a safe test.")

    import requests  # only needed when actually sending

    load_env()
    domain, email, key = (os.environ.get(k) for k in ("GORGIAS_DOMAIN", "GORGIAS_EMAIL", "GORGIAS_API_KEY"))
    if not (domain and email and key):
        sys.exit("Set GORGIAS_DOMAIN, GORGIAS_EMAIL and GORGIAS_API_KEY in .env")
    domain = domain.replace("https://", "").replace(".gorgias.com", "").strip("/ ")
    session = requests.Session()
    session.auth = (email, key)
    session.headers.update({"Accept": "application/json", "Content-Type": "application/json"})
    base = f"https://{domain}.gorgias.com"

    created = []
    for i, (ticket, meta) in enumerate(built, 1):
        try:
            res = post_ticket(session, base, ticket)
        except RuntimeError as e:
            with open(os.path.join(ROOT, "integrations", "out", "gorgias_created.json"), "w") as f:
                json.dump(created, f, indent=2)
            sys.exit(f"Ticket {i} failed, stopping after {len(created)} created. {e}")
        created.append({"id": res.get("id"), "order": meta["order"]})
        print(f"{i:3}/{len(built)}  ticket {res.get('id')}  {meta['order']}  {meta['source']:9}  {meta['state']}  {ticket['status']}")
        time.sleep(0.6)
    with open(os.path.join(ROOT, "integrations", "out", "gorgias_created.json"), "w") as f:
        json.dump(created, f, indent=2)
    print(f"\nDone: {len(created)} tickets created, all tagged sample-data and {a.batch}.")


if __name__ == "__main__":
    main()
