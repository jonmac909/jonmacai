#!/usr/bin/env python3
"""Apply Ana's 2026-11-11 sponsor plan to a dashboard: moves, adds and amounts through POST /dashboard/api/actions.
Usage: apply_sponsor_plan.py BASE_URL [--cookie C | env DASH_COOKIE] [--dry-run]
Sends X-CC: 1. Writes D:\AgentTeam\qc-work\money-deals-rebuild\deals-final.json."""
import argparse, json, os, sys, urllib.request

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
gid = lambda t: "gmail-thread-" + t

def plan():
    acts = [("sponsor.move_stage", {"id": gid(t), "stage": s}) for t, s in MOVES]
    for t, b, s, a, n in ADDS:
        acts.append(("sponsor.add_deal", {"id": gid(t), "threadId": t, "brand": b, "stage": s, "next": n, **({"amount": AMOUNTS[t]} if t in AMOUNTS else {})}))
    for t, a in AMOUNTS.items():
        acts.append(("sponsor.set_amount", {"id": gid(t), "amount": a, **({"brand": BRANDS[t]} if t in BRANDS else {})}))
    return acts

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base"); ap.add_argument("--cookie"); ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    cookie = a.cookie or os.environ.get("DASH_COOKIE", "")
    acts = plan(); results = []
    for kind, payload in acts:
        if a.dry_run:
            print("DRY", kind, json.dumps(payload)); results.append({"kind": kind, "payload": payload}); continue
        req = urllib.request.Request(a.base.rstrip("/") + "/dashboard/api/actions", json.dumps({"kind": kind, "payload": payload, "idemKey": kind + ":" + json.dumps(payload, sort_keys=True)}).encode(),
                                     {"Content-Type": "application/json", "X-CC": "1", "Cookie": cookie, "User-Agent": "apply-sponsor-plan/1"})
        try:
            r = json.load(urllib.request.urlopen(req))
        except Exception as e:
            r = {"error": str(e)}
        print(kind, payload["id"], r); results.append({"kind": kind, "payload": payload, "result": r})
    n = lambda k: sum(1 for x, _ in acts if x == k)
    print(f"SUMMARY moves={n('sponsor.move_stage')} adds={n('sponsor.add_deal')} amounts={n('sponsor.set_amount')}")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({"dryRun": a.dry_run, "base": a.base, "actions": results}, open(OUT, "w", encoding="utf8"), indent=1)

if __name__ == "__main__":
    sys.exit(main())
