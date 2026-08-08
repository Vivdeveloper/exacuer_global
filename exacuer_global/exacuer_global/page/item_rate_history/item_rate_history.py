import frappe, json
from frappe.utils import nowdate, add_days, flt, fmt_money
from collections import defaultdict

@frappe.whitelist()
def get_price_history(filters):
    if isinstance(filters, str):
        filters = json.loads(filters)

    # ---- Date Range ----
    date_ranges = {"Last Week": -7, "Last Month": -30, "Last 3 Months": -90, "Last Year": -365}
    if filters.get("date_range") == "Select Date Range" and filters.get("selected_date_range"):
        start_date, end_date = filters["selected_date_range"]
    else:
        start_date = add_days(nowdate(), date_ranges.get(filters.get("date_range"), -90))
        end_date = nowdate()

    where_pi = ["pi.docstatus=1", "pi.posting_date BETWEEN %s AND %s"]
    where_si = ["si.docstatus=1", "si.posting_date BETWEEN %s AND %s"]
    params_pi = [start_date, end_date]
    params_si = [start_date, end_date]

    if filters.get("company"):
        where_pi.append("pi.company=%s"); params_pi.append(filters["company"])
        where_si.append("si.company=%s"); params_si.append(filters["company"])
    if filters.get("supplier"):
        where_pi.append("pi.supplier=%s"); params_pi.append(filters["supplier"])
    if filters.get("customer"):
        where_si.append("si.customer=%s"); params_si.append(filters["customer"])

    items = []
    if filters.get("item"): 
        items.extend(filters["item"])
    if filters.get("item_group") and not filters.get("item"):
        items.extend(frappe.get_all("Item", filters={"item_group": filters["item_group"]}, pluck="name"))
    if items:
        where_pi.append("pii.item_code in %s"); params_pi.append(tuple(items))
        where_si.append("sii.item_code in %s"); params_si.append(tuple(items))

    # ---- Purchase Invoice ----
    sql_pi = f"""
        SELECT pi.posting_date, pii.item_code, pii.item_name,
               pi.supplier as party, pi.name invoice_no,
               pii.rate, pi.currency
        FROM `tabPurchase Invoice` pi
        JOIN `tabPurchase Invoice Item` pii ON pii.parent = pi.name
        WHERE {" AND ".join(where_pi)}
        ORDER BY pi.posting_date ASC
    """
    purchase_res = frappe.db.sql(sql_pi, tuple(params_pi), as_dict=True)

    # ---- Sales Invoice ----
    sql_si = f"""
        SELECT si.posting_date, sii.item_code, sii.item_name,
               si.customer as party, si.name invoice_no,
               sii.rate, si.currency
        FROM `tabSales Invoice` si
        JOIN `tabSales Invoice Item` sii ON sii.parent = si.name
        WHERE {" AND ".join(where_si)}
        ORDER BY si.posting_date ASC
    """
    sales_res = frappe.db.sql(sql_si, tuple(params_si), as_dict=True)

    # ---- Grouped by Item ----
    item_map = defaultdict(lambda: {"purchase": [], "sales": []})
    for r in purchase_res:
        item_map[r.item_code]["purchase"].append(r)
    for r in sales_res:
        item_map[r.item_code]["sales"].append(r)

    # ---- Helper for per-item summary ----
    def make_summary(history):
        summary = {"last_rate": None, "highest": None, "lowest": None, "pct_change": None}
        if history:
            last = history[-1]
            summary["last_rate"] = last["rate"]
            hi = max(history, key=lambda x: x["raw_rate"])
            lo = min(history, key=lambda x: x["raw_rate"])
            summary["highest"] = hi["rate"]
            summary["lowest"] = lo["rate"]
            if len(history) >= 2 and history[-2]["raw_rate"]:
                pct = (history[-1]["raw_rate"] - history[-2]["raw_rate"]) / history[-2]["raw_rate"] * 100
                summary["pct_change"] = f"{flt(pct,2)}%"
        return summary

    # ---- Item Cards ----
    item_cards = []
    for item_code, data in item_map.items():
        item_doc = frappe.get_value("Item", item_code, ["item_name", "image"], as_dict=True) or {}

        purchase_history = [{
            "date": str(r.posting_date),
            "party": r.party,
            "invoice": r.invoice_no,
            "rate": fmt_money(r.rate, currency=r.currency),
            "raw_rate": flt(r.rate)
        } for r in data["purchase"]]

        sales_history = [{
            "date": str(r.posting_date),
            "party": r.party,
            "invoice": r.invoice_no,
            "rate": fmt_money(r.rate, currency=r.currency),
            "raw_rate": flt(r.rate)
        } for r in data["sales"]]

        item_cards.append({
            "item_code": item_code,
            "item_name": item_doc.get("item_name") or (data["purchase"][0].item_name if data["purchase"] else data["sales"][0].item_name),
            "image": item_doc.get("image"),
            "purchase_history": purchase_history,
            "sales_history": sales_history,
            "summary": {
                "purchase": make_summary(purchase_history),
                "sales": make_summary(sales_history)
            }
        })

    return {"item_cards": item_cards}
