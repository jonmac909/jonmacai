#!/usr/bin/env bash
# curl check of every /dashboard/api/v1 endpoint on a deployed Worker.
#   scripts/smoke-v1.sh preview <origin> <jon-session-secret-file>   full flow incl. Jon's endpoints
#   scripts/smoke-v1.sh live    <origin>                             auth, reads and refused writes only
# Tokens come from $DASH_TOKEN_DIR (default D:/AgentTeam/secrets/bot-tokens) and are never printed.
set -u
mode="$1"; origin="${2%/}"; secret_file="${3:-}"
api="$origin/dashboard/api/v1"
dir="${DASH_TOKEN_DIR:-D:/AgentTeam/secrets/bot-tokens}"
tok() { tr -d '\r\n' < "$dir/$1.token"; }
pass=0; fail=0
body=""; code=""

req() { # req METHOD PATH AUTH(bot slug|none|bad|jon|jon-nocc) [JSON]
  local method="$1" path="$2" who="$3" data="${4:-}"
  local args=(-s -o /tmp/smoke-body -w '%{http_code}' -X "$method")
  case "$who" in
    none) ;;
    bad) args+=(-H "Authorization: Bearer ccb_0000000000000000000000000000000000000000000") ;;
    jon) args+=(-H "Cookie: __Host-cc_session=$jon_cookie" -H 'X-CC: 1') ;;
    jon-nocc) args+=(-H "Cookie: __Host-cc_session=$jon_cookie") ;;
    *) args+=(-H "Authorization: Bearer $(tok "$who")") ;;
  esac
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' --data "$data")
  code=$(curl "${args[@]}" "$api$path")
  body=$(cat /tmp/smoke-body)
}
field() { python -c "import sys,json; d=json.loads(sys.argv[1]); print(eval(sys.argv[2]))" "$body" "$1"; }
expect() { # expect LABEL STATUS [PYEXPR EXPECTED]
  local label="$1" want="$2" ok=1 got=""
  [ "$code" = "$want" ] || ok=0
  if [ $ok = 1 ] && [ $# -ge 4 ]; then got=$(field "$3" 2>/dev/null); [ "$got" = "$4" ] || ok=0; fi
  if [ $ok = 1 ]; then pass=$((pass+1)); echo "PASS $code $label"; else fail=$((fail+1)); echo "FAIL $code $label (want $want${4:+ and $3=$4, got $got}) $(echo "$body" | head -c 200)"; fi
}

# Existing routes keep their behaviour.
code=$(curl -s -o /dev/null -w '%{http_code}' "$origin/dashboard/"); body=""; expect "GET /dashboard/ (login page)" 200
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{}' "$origin/dashboard/api/ingest"); expect "POST /api/ingest without machine token" 401
code=$(curl -s -o /dev/null -w '%{http_code}' "$origin/dashboard/api/snapshot"); expect "GET /api/snapshot without session" 401
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $(tok developer)" --data '{"machine":"gpu1"}' "$origin/dashboard/api/actions/claim"); expect "POST /api/actions/claim with a bot token" 401

req GET /me none; expect "GET /me no token" 401
req GET /me bad; expect "GET /me wrong token" 401
for b in $(ls "$dir" | sed -n 's/\.token$//p'); do req GET /me "$b"; expect "GET /me as $b" 200 "d['bot']" "$b"; done

if [ "$mode" = live ]; then
  req GET '/tasks?owner=me' developer; expect "GET /tasks" 200
  req GET '/tasks/t_0000000000000000' developer; expect "GET /tasks/:id unknown" 404
  req POST /tasks developer '{"title":""}'; expect "POST /tasks refuses empty title (writes nothing)" 400
  req PATCH /tasks/t_0000000000000000 developer '{"status":"doing"}'; expect "PATCH /tasks/:id unknown" 404
  req POST /tasks/t_0000000000000000/proofs developer '{"kind":"url","link":"https://jonmac.ai"}'; expect "POST /tasks/:id/proofs unknown task" 404
  req GET '/proofs?status=pending' qc; expect "GET /proofs" 200
  req POST /proofs/p_0000000000000000/check developer '{"result":"passed"}'; expect "POST /proofs/:id/check not QC" 403
  req POST /questions developer '{"question":""}'; expect "POST /questions refuses empty question" 400
  req GET '/questions?asked_by=me' developer; expect "GET /questions" 200
  req GET /questions/q_0000000000000000 developer; expect "GET /questions/:id unknown" 404
  req POST /questions/q_0000000000000000/close developer; expect "POST /questions/:id/close unknown" 404
  req POST /questions/q_0000000000000000/answer developer '{"answer":"x"}'; expect "POST /questions/:id/answer as a bot" 403
  req POST /approvals developer '{"action":"Bad Action","title":"x"}'; expect "POST /approvals refuses bad action" 400
  req GET '/approvals?status=approved' developer; expect "GET /approvals" 200
  req GET /approvals/a_0000000000000000 developer; expect "GET /approvals/:id unknown" 404
  req POST /approvals/a_0000000000000000/decide developer '{"decision":"approve"}'; expect "POST /approvals/:id/decide as a bot" 403
  req POST /approvals/a_0000000000000000/claim developer; expect "POST /approvals/:id/claim unknown" 404
  req POST /approvals/a_0000000000000000/done developer; expect "POST /approvals/:id/done unknown" 404
  req POST /approvals/a_0000000000000000/release developer; expect "POST /approvals/:id/release unknown" 404
  req POST /approvals/a_0000000000000000/cancel developer; expect "POST /approvals/:id/cancel unknown" 404
  req POST /runs developer '{"status":"nope"}'; expect "POST /runs refuses bad status" 400
  req GET '/runs?bot=me' developer; expect "GET /runs" 200
else
  exp=$(( $(date +%s) + 900 ))
  jon_cookie="$exp.$(node -e "const c=require('crypto');process.stdout.write(c.createHmac('sha256',require('fs').readFileSync(process.argv[1],'utf8').trim()).update(process.argv[2]).digest('hex'))" "$secret_file" "$exp")"
  key="smoke-$(date +%s)"
  req POST /tasks developer "{\"title\":\"Smoke task\",\"owner\":\"video-editor\",\"key\":\"$key\"}"; expect "POST /tasks" 201 "d['task']['owner']" video-editor
  task=$(field "d['task']['id']")
  req POST /tasks developer "{\"title\":\"Smoke task again\",\"key\":\"$key\"}"; expect "POST /tasks same key returns the first" 200 "d['task']['id']" "$task"
  req PATCH "/tasks/$task" video-editor '{"status":"qc"}'; expect "PATCH qc without proof" 409
  req POST "/tasks/$task/proofs" video-editor '{"kind":"render","link":"D:\\renders\\smoke.mp4","note":"smoke"}'; expect "POST /tasks/:id/proofs" 201 "d['proof']['status']" pending
  proof=$(field "d['proof']['id']")
  req POST "/tasks/$task/proofs" video-editor '{"kind":"url","link":"javascript:alert(1)"}'; expect "POST proof refuses javascript: link" 400
  req GET '/proofs?status=pending' qc; expect "GET /proofs?status=pending" 200 "[p['id'] for p in d['proofs']].count('$proof')" 1
  req POST "/proofs/$proof/check" developer '{"result":"passed"}'; expect "POST /proofs/:id/check by non-QC" 403
  req PATCH "/tasks/$task" video-editor '{"status":"review"}'; expect "PATCH review before QC passed refused" 409
  req POST "/proofs/$proof/check" qc '{"result":"passed","note":"smoke"}'; expect "POST /proofs/:id/check by QC" 200 "d['proof']['status']" passed
  req PATCH "/tasks/$task" video-editor '{"status":"done"}'; expect "PATCH done by a bot refused" 403
  req PATCH "/tasks/$task" video-editor '{"status":"review"}'; expect "PATCH /tasks/:id review" 200 "d['task']['status']" review
  req GET "/tasks?owner=video-editor&status=review" qc; expect "GET /tasks?owner&status" 200 "[t['id'] for t in d['tasks']].count('$task')" 1
  req PATCH "/tasks/$task" jon '{"status":"done"}'; expect "Jon approves review" 200 "d['task']['status']" done
  req GET "/tasks/$task" sponsors; expect "GET /tasks/:id with proof" 200 "len(d['task']['proofs'])" 1
  req POST /questions developer "{\"question\":\"Smoke question?\",\"options\":[\"Yes\",\"No\"],\"task\":\"$task\"}"; expect "POST /questions" 201 "d['question']['options']" "['Yes', 'No']"
  q=$(field "d['question']['id']")
  req POST "/questions/$q/answer" developer '{"answer":"Yes"}'; expect "POST answer as a bot" 403
  req POST "/questions/$q/answer" jon-nocc '{"answer":"Yes"}'; expect "POST answer as Jon without X-CC" 403
  req POST "/questions/$q/answer" jon '{"answer":"Yes"}'; expect "POST /questions/:id/answer as Jon" 200 "d['question']['status']" answered
  req POST "/questions/$q/answer" jon '{"answer":"No"}'; expect "second answer refused" 409
  req GET "/questions/$q" developer; expect "GET /questions/:id reads the answer" 200 "d['question']['answer']" Yes
  req GET "/questions?asked_by=me&status=answered" developer; expect "GET /questions?asked_by=me" 200 "[x['id'] for x in d['questions']].count('$q')" 1
  req POST "/questions/$q/close" qc; expect "close by another bot" 403
  req POST "/questions/$q/close" developer; expect "POST /questions/:id/close" 200 "d['question']['status']" closed
  req POST /approvals developer '{"action":"send_pitches","title":"Smoke approval","payload":{"count":2}}'; expect "POST /approvals" 201 "d['approval']['status']" pending
  a=$(field "d['approval']['id']")
  req POST "/approvals/$a/done" developer; expect "done before approval refused" 409
  req POST "/approvals/$a/decide" developer '{"decision":"approve"}'; expect "decide as a bot refused" 403
  req POST "/approvals/$a/decide" jon '{"decision":"approve","note":"smoke"}'; expect "POST /approvals/:id/decide as Jon" 200 "d['approval']['status']" approved
  req GET "/approvals?status=approved&action=send_pitches" sponsors; expect "GET /approvals?status=approved" 200 "[x['id'] for x in d['approvals']].count('$a')" 1
  req GET "/approvals/$a" developer; expect "GET /approvals/:id" 200 "d['approval']['payload']['count']" 2
  req POST "/approvals/$a/done" developer; expect "done before claim refused" 409
  req POST "/approvals/$a/claim" sponsors; expect "claim by another bot refused" 403
  req POST "/approvals/$a/claim" developer; expect "POST /approvals/:id/claim" 200 "d['approval']['status']" running
  req POST "/approvals/$a/claim" developer; expect "second claim refused" 409
  req POST "/approvals/$a/release" developer '{"note":"smoke"}'; expect "POST /approvals/:id/release" 200 "d['approval']['status']" approved
  req POST "/approvals/$a/claim" developer; expect "claim again after release" 200
  req POST "/approvals/$a/done" developer '{"note":"smoke"}'; expect "POST /approvals/:id/done" 200 "d['approval']['status']" done
  req POST /approvals developer '{"action":"publish_draft","title":"Smoke cancel"}'; a2=$(field "d['approval']['id']")
  req POST "/approvals/$a2/cancel" developer '{"note":"smoke"}'; expect "POST /approvals/:id/cancel" 200 "d['approval']['status']" cancelled
  req POST /tasks developer '{"title":"Smoke cancel task"}'; t2=$(field "d['task']['id']")
  req PATCH "/tasks/$t2" developer '{"status":"cancelled","note":"smoke"}'; expect "PATCH /tasks/:id cancelled" 200 "d['task']['status']" cancelled
  req POST /runs developer "{\"status\":\"ok\",\"tokens\":42,\"task\":\"$task\"}"; expect "POST /runs" 201 "d['run']['bot']" developer
  req POST /runs developer '{"bot":"qc","status":"ok"}'; expect "POST /runs for another bot refused" 403
  req GET '/runs?bot=me' developer; expect "GET /runs?bot=me" 200
  req GET /me jon; expect "GET /me as Jon" 200 "d['jon']" True
fi
echo "smoke $mode: $pass passed, $fail failed"
[ "$fail" = 0 ]
