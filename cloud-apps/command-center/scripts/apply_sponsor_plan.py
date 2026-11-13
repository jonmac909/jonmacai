#!/usr/bin/env python3
r"""Apply Ana's 2026-11-11 sponsor plan to a dashboard: moves, adds and amounts.
Usage: apply_sponsor_plan.py BASE_URL [read] [--token-bot SLUG [--token-file F] | --cookie C | env DASH_COOKIE] [--dry-run] [--out F]
--token-bot: bot Bearer token (D:\AgentTeam\secrets\bot-tokens\<slug>.token, or --token-file for a preview token),
  POST /dashboard/api/v1/sponsors/actions. --cookie: Jon's session, POST /dashboard/api/actions with X-CC: 1.
read: GET /dashboard/api/v1/sponsors (token only) and print card counts per column, To close / To collect, Topview and Arcads.
Writes D:\AgentTeam\qc-work\money-deals-rebuild\deals-final.json (or --out)."""
import argparse, json, os, re, sys, urllib.error, urllib.parse, urllib.request
from pathlib import Path

ARCHIVE = "1a1591983a010b39 1a1831ee29e12656 1a100fca30a15755 1a087f484852c575 19f68e77b0d330f1 1a176291fb3afb9f 1a0acaf42e06c279 1a140abb90a6cb8e 1a17ab631ca1fa85 1a11d63686781aef 1a0de0dd49b7a494 1a1148dbe5a15491 1a1921b958ae7351 1a16ca8408f9ba45 1a13372b13495a52 1a1a26bda8c7af0e 1a17e62e379dcf1e 1a19d4ee5bc7a989 1a187901df7b1bae 1a1a17a32f603e78 1a1075f2458e886a 1a1a0f150ba2544d 1a095b91a0604aec 1a188321b120540e 1a1c5669ca10d277 1a09f81f9207d0e1 1a19f5af492b3f67 1a12d18a25696cb3 1a0874c7523d0039 1a0ca7b4001e9557 1a062af4c3da3601 1a0d430648d1e5ae 1a19c7c9d8163dd9 1a0ff9d785e1635d 1a0aefac7b3d4b6a 1a0e7a2fd981655a 1a116c0e136bee30".split()
MOVES = [(t, "archived") for t in ARCHIVE] + [
    ("1a1b1ce17022c48b", "negotiating"), ("1a1b13679cd7909b", "negotiating"), ("1a18839a1c32e736", "negotiating"),
    ("1a1150ee352149da", "paid"), ("19de08dafc08e1d4", "publishing"),
    ("1a0aa308142f5466", "contract-brief"), ("1a11a047792ddd0b", "contract-brief"), ("1a1c0d26b71240b5", "contract-brief"),
]
# (thread id, brand, stage, amount or None, next)
ADDS = [
    ("1a1213c3e19344a7", "Topview", "balance-invoice", None, "Collect balance, invoice #1073"),
    ("1a1213c47e88d97d", "Arcads", "contract-brief", None, "Q4 video 1, script sent 11-11"),
] + [(t, b, "negotiating", None, "Rates sent, waiting") for t, b in [
    ("1a1c859c4aaa74e2", "VideoGen"), ("1a1c6d0462e5a453", "Flick"), ("1a1c6b0ea2a3aaa7", "Garren"), ("1a1c49e73ec86448", "Revana"),
    ("1a1c44b75dee9b1c", "TensorArt Forge"), ("1a1b12e56ad3b80c", "Proveny"), ("1a1ac653ed5404bf", "PropellerAds/Monetag"),
    ("1a1abb9d08139d35", "inkome"), ("1a1a746f7502dddd", "Make.com via Railo"), ("1a1a58287c79a090", "WaveSpeedAI"),
    ("1a1a558959518917", "BytePlus via Deeplink"), ("1a19a73e3881e2df", "Fetra"), ("1a1920de7f3179e2", "EcomTrackr"),
    ("1a1a6ebaa592a632", "Luminary/Ashlie"), ("1a1c0b5fb13575be", "Netz via Soft Story"), ("1a1bf7c324bf6f33", "Migoo"),
    ("1a1a72fab5d263e1", "Submagic"), ("1a1618b071848059", "Holopix"), ("19cf57fa54dfe839", "ReelForge"), ("1a123971d83a0e89", "Littlebird")]
] + [
    # drafts are added (curated) so the new-lead/drafts junk filter does not hide them
    ("1a1c6a991715ca3d", "Topview T1 promo", "drafts", None, "Needs rate reply"), ("1a082b1c04b4fcfb", "Creatify", "drafts", None, "Reply to their tier prices"),
    ("1a16981a6a15103f", "Lomote", "drafts", None, "Needs rate reply"), ("1a1c21bd78a3f390", "Zayden TikTok Shop Launch", "drafts", None, "Rates reply drafted")]
# Amounts in USD (build/amounts-found.md): Topview/Arcads = to collect; agreed deals; leads = Jon's quoted dedicated-video rate. Unlisted = blank.
AMOUNTS = {"1a1213c3e19344a7": 2000, "1a1213c47e88d97d": 1500, "1a1150ee352149da": 4200, "1a0aa308142f5466": 3000, "1a11a047792ddd0b": 3000, "1a1c0d26b71240b5": 1000}
AMOUNTS.update({t: 2500 for t in "1a1c859c4aaa74e2 1a1c6d0462e5a453 1a1c6b0ea2a3aaa7 1a1c49e73ec86448 1a1c44b75dee9b1c 1a1ac653ed5404bf 1a1abb9d08139d35 1a1a58287c79a090 1a1a558959518917 1a19a73e3881e2df 1a1920de7f3179e2 1a1a6ebaa592a632 1a1bf7c324bf6f33 1a1a72fab5d263e1 1a1c21bd78a3f390 1a1b13679cd7909b 19cf57fa54dfe839 1a123971d83a0e89 1a1b1ce17022c48b".split()})
# The source snapshot mangled these names (Luminarysm, ve AI); the subjects say Enter and Naive AI.
BRANDS = {"1a0aa308142f5466": "Enter", "1a11a047792ddd0b": "Naive AI"}
OUT = r"D:\AgentTeam\qc-work\money-deals-rebuild\deals-final.json"
TOKEN_DIR = Path(r"D:\AgentTeam\secrets\bot-tokens")
UA = "apply-sponsor-plan/1"
gid = lambda t: "gmail-thread-" + t

def plan():
    acts = [("sponsor.move_stage", {"id": gid(t), "stage": s}) for t, s in MOVES]
    for t, b, s, a, n in ADDS:
        acts.append(("sponsor.add_deal", {"id": gid(t), "threadId": t, "brand": b, "stage": s, "next": n, **({"amount": AMOUNTS[t]} if t in AMOUNTS else {})}))
    for t, a in AMOUNTS.items():
        acts.append(("sponsor.set_amount", {"id": gid(t), "amount": a, **({"brand": BRANDS[t]} if t in BRANDS else {})}))
    return acts

def read_token(slug, path=None):
    r"""Same rules as D:\AgentTeam\tools\dash.py read_token; --token-file overrides the path (preview tokens)."""
    if not re.match(r"^[a-z0-9][a-z0-9-]{0,39}$", slug or ""):
        sys.exit("Bad bot name: %s" % slug)
    p = Path(path) if path else TOKEN_DIR / ("%s.token" % slug)
    try:
        token = p.read_text(encoding="utf-8").strip()
    except OSError:
        sys.exit("No token file for %s at %s." % (slug, p))
    if not token:
        sys.exit("Token file %s is empty." % p)
    return token

def send(url, headers, body=None):
    req = urllib.request.Request(url, json.dumps(body).encode() if body is not None else None, headers, method="POST" if body is not None else "GET")
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        try:
            detail = json.load(e)
        except Exception:
            detail = None
        return {"error": "HTTP %s" % e.code, "detail": detail}
    except Exception as e:
        return {"error": str(e)}

def failed(r):
    if not isinstance(r, dict):
        return True
    return bool(r.get("error")) or r.get("ok") is False or r.get("status") in ("failed", "error")

def read(base, headers):
    r = send(base + "/dashboard/api/v1/sponsors", headers)
    if failed(r) or not (r.get("board") or {}).get("columns"):
        print("READ FAILED", json.dumps(r)[:500]); return 1
    cols = r["board"]["columns"]
    print("asOf", r.get("asOf"))
    print("columns:", ", ".join("%s %d" % (c.get("title"), len(c.get("cards") or [])) for c in cols))
    p = r.get("pipeline") or {}
    t = p.get("totals") or {}
    print("To close: $%s (%d deals)  To collect: $%s (%d deals)" % (t.get("close"), len(p.get("close") or []), t.get("collect"), len(p.get("collect") or [])))
    for brand in ("Topview", "Arcads"):
        hits = [(c.get("title"), k) for c in cols for k in c.get("cards") or [] if str(k.get("name", "")).lower().startswith(brand.lower())]
        for title, k in hits or [(None, {})]:
            print("%-8s %s" % (brand, "not on the board" if title is None else "%s | stage %s | amount %s | %s" % (k.get("name"), title, k.get("amt"), k.get("id"))))
    return 0

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base"); ap.add_argument("cmd", nargs="?", choices=["apply", "read"], default="apply")
    ap.add_argument("--cookie"); ap.add_argument("--token-bot"); ap.add_argument("--token-file")
    ap.add_argument("--dry-run", action="store_true"); ap.add_argument("--out", default=OUT)
    a = ap.parse_args()
    base = a.base.rstrip("/")
    if a.token_bot:
        host = urllib.parse.urlsplit(base)
        if host.scheme != "https" and host.hostname not in ("localhost", "127.0.0.1"):
            sys.exit("Token mode needs an https base (or localhost): %s" % base)
        url = base + "/dashboard/api/v1/sponsors/actions"
        headers = {"Content-Type": "application/json", "Authorization": "Bearer " + read_token(a.token_bot, a.token_file), "User-Agent": UA}
    else:
        url = base + "/dashboard/api/actions"
        headers = {"Content-Type": "application/json", "X-CC": "1", "Cookie": a.cookie or os.environ.get("DASH_COOKIE", ""), "User-Agent": UA}
    if a.cmd == "read":
        if not a.token_bot:
            sys.exit("read needs --token-bot")
        return read(base, headers)
    acts = plan(); results = []; errors = 0
    for kind, payload in acts:
        if a.dry_run:
            print("DRY", kind, json.dumps(payload)); results.append({"kind": kind, "payload": payload}); continue
        r = send(url, headers, {"kind": kind, "payload": payload, "idemKey": kind + ":" + json.dumps(payload, sort_keys=True)})
        errors += failed(r)
        print(kind, payload["id"], r); results.append({"kind": kind, "payload": payload, "result": r})
    n = lambda k: sum(1 for x, _ in acts if x == k)
    print(f"SUMMARY moves={n('sponsor.move_stage')} adds={n('sponsor.add_deal')} amounts={n('sponsor.set_amount')} errors={errors}{' (dry run)' if a.dry_run else ''} via={'token:' + a.token_bot if a.token_bot else 'cookie'}")
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump({"dryRun": a.dry_run, "base": a.base, "errors": errors, "actions": results}, open(a.out, "w", encoding="utf8"), indent=1)
    return 1 if errors else 0

if __name__ == "__main__":
    sys.exit(main())
