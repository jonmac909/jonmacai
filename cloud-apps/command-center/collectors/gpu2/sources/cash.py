"""Sponsor cash received, from my-agent/state/sponsors/cash_ledger.csv (date, sponsor, amount).
Only date, sponsor, invoice number, USD amount and status leave the machine; never the evidence column."""
import csv
import os
from datetime import datetime, timezone
from pathlib import Path

LEDGER = Path(os.environ.get('CC_CASH_LEDGER') or (Path.home() / 'my-agent' / 'state' / 'sponsors' / 'cash_ledger.csv'))


def source(_machine):
    return 'sponsors_cash'


def read_ledger(path=LEDGER):
    rows = []
    with open(path, encoding='utf-8-sig', newline='') as fh:
        for r in csv.DictReader(fh):
            date = (r.get('date') or '').strip()
            if len(date) != 10:
                continue
            amt = (r.get('amount_usd') or '').replace(',', '').strip()
            try:
                usd = round(float(amt), 2) if amt else None
            except ValueError:
                usd = None
            rows.append({
                'date': date,
                'sponsor': (r.get('sponsor') or '').strip()[:60],
                'invoice': (r.get('invoice') or '').strip()[:12],
                'usd': usd,
                'status': (r.get('status') or '').strip()[:20],
            })
    return rows


def collect(_machine):
    if not LEDGER.is_file():
        return {'ok': False, 'error': 'cash ledger not found', 'rows': []}
    edited = datetime.fromtimestamp(LEDGER.stat().st_mtime, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    return {'ok': True, 'ledgerEditedAt': edited, 'rows': read_ledger()}
