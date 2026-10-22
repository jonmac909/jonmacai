# Command Center redesign · V1 Home, V3 Team, V4 Content

Screenshots of the three redesigned pages rendered against the live D1 snapshot from
**2026-10-22 08:10 PT** (15:10 UTC). Full page, 1440 px wide, Geist, tokens.css light and dark.

| Page | Light | Dark |
| --- | --- | --- |
| Home (V1) | `home-light.png` | `home-dark.png` |
| Team (V3) | `team-light.png` | `team-dark.png` |
| Content (V4) | `content-light.png` | `content-dark.png` |

Mockups Jon picked (sample data, in Ana's folder): `D:\OpenMausBot\Ana\dashboard-redesign\v1.png`,
`v3.png`, `v4.png`.

## How the screenshots were made

No sign-in and no deploy. The worker's own `mergeSnapshot()` was replayed locally over rows
exported read-only from D1 (`command_center`, `jonmac-review`, `jonmacai-clone-upsells`), served
by a throwaway Node server on `127.0.0.1:8788`. Times and staleness are judged at the export
timestamp, not at render time. The Team page uses the real output of the new GPU1
`collectors/gpu1/team.py` dry run (bots.json + routines.json + thread events).

## Tiles that still say "no data", and why

- **Weekly output per channel** (14 styles 42, @JonMacAI 3, Affiliate 7, shorts, Spotify 7, main
  channel): no source records published videos. The production feed shows work in progress, so
  each card says how many rows are in production and how long the oldest has been in stage.
- **Views this week**: no per-week view feed; the YouTube sync last ran 2026-09-22.
- **Webinar sign-ups / seats**: the Oct 29 Zoom Meeting has no registration list and no seat
  target is recorded.
- **Videos published this week** (Home strip) and the **Published** kanban column: same missing
  published-video log.
- **Paul's past slots** say "no record": there is no completion log for the 4-hour video cadence.

## What is real on these screens

Sponsor cash October ($1,734.37, 2 payments, $5,200 owed), Viral View MRR ($185, 5 paying
customers), funnel link clicks (13,178 last 30 days), trials (0), new revenue ($0.00), Waiting On
You (2 asks + 1 video ready for Jon), production board (Ideas 2, Building 9, QC 3, Ready for Jon
1), Paul's next slot (10:50), 16 bots by section with status/model/next routine, and GPU1/GPU2
load (100% GPU, 30.9/31.8 GB and 17/24 GB VRAM).

The Team page needs the new `team` collector to run once on GPU1 (it is wired into
`collectors/gpu1/beat.py`) before the deployed dashboard shows bot cards.
