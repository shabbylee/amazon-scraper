#!/usr/bin/env bash
# Value Delta 多 Listing 采集：搜索页拿 ASIN 列表，再逐 ASIN 抓详情。
#
# 用法：
#   collect.sh            # 搜索 + 详情（默认）
#   collect.sh search     # 只搜索落库
#   collect.sh details    # 只抓详情（对库中 variants 为空的 ASIN）
#
# 环境变量：
#   SCRAPER_BASE      采集层 HTTP 服务（默认 http://localhost:3456）
#   SCRAPER_DB        SQLite 路径（默认 data/amazon.db）
#   SCRAPER_KEYWORD   搜索关键字（默认 laptop）
#   SCRAPER_PAGES     搜索页数（默认 1）
#   SCRAPER_INTERVAL  相邻请求间隔秒数（默认 2.5，守住 ≥2s 限速硬约束）
set -euo pipefail

BASE="${SCRAPER_BASE:-http://localhost:3456}"
DB="${SCRAPER_DB:-data/amazon.db}"
KEYWORD="${SCRAPER_KEYWORD:-laptop}"
PAGES="${SCRAPER_PAGES:-1}"
INTERVAL="${SCRAPER_INTERVAL:-2.5}"
MODE="${1:-all}"

say() { printf '[collect] %s\n' "$*"; }

require_server() {
  if ! curl -sf "${BASE}/api/health" >/dev/null 2>&1; then
    say "采集层未响应：${BASE}/api/health"
    say "先启动服务（npm start 或 npm run dev）再跑本脚本。"
    exit 1
  fi
}

do_search() {
  say "搜索 keyword=${KEYWORD} pages=${PAGES}"
  curl -sf -X POST "${BASE}/api/scrape" \
    -H 'content-type: application/json' \
    -d "{\"keyword\":\"${KEYWORD}\",\"pages\":${PAGES}}"
  echo
}

pending_asins() {
  sqlite3 "${DB}" \
    "SELECT asin FROM listings \
     WHERE marketplace = 'com' AND variants IS NULL \
     ORDER BY price_num ASC;"
}

do_details() {
  require_server
  local asins=()
  while IFS= read -r line; do
    asins+=("${line}")
  done < <(pending_asins)
  local total=${#asins[@]}
  say "待抓详情 ${total} 个 ASIN（variants 为空的 com Listing）"
  if [[ ${total} -eq 0 ]]; then
    say "无待抓 ASIN；先跑 search。"
    return
  fi

  local ok=0 fail=0 captcha=0 i=0
  for asin in "${asins[@]}"; do
    i=$((i + 1))
    local resp
    if ! resp=$(curl -sf -X POST "${BASE}/api/detail" \
      -H 'content-type: application/json' \
      -d "{\"asin\":\"${asin}\"}" 2>/dev/null); then
      fail=$((fail + 1))
      say "[${i}/${total}] ${asin} HTTP 请求失败"
      sleep "${INTERVAL}"
      continue
    fi

    if echo "${resp}" | grep -q '"saved":1'; then
      ok=$((ok + 1))
      say "[${i}/${total}] ${asin} OK"
    else
      fail=$((fail + 1))
      if echo "${resp}" | grep -q '"failure":"captcha"'; then
        captcha=$((captcha + 1))
        say "[${i}/${total}] ${asin} CAPTCHA，按伦理线停止本次采集"
        break
      fi
      local why
      why=$(echo "${resp}" | grep -o '"failure":"[a-z-]*"' | head -1 || true)
      say "[${i}/${total}] ${asin} 失败 ${why:-unknown}"
    fi
    sleep "${INTERVAL}"
  done
  say "完成：ok=${ok} fail=${fail} captcha=${captcha} 已处理=${i}/${total}"
}

case "${MODE}" in
  search)
    require_server
    do_search
    ;;
  details)
    do_details
    ;;
  all)
    require_server
    do_search
    sleep "${INTERVAL}"
    do_details
    ;;
  *)
    say "未知模式：${MODE}（可选 search | details | all）"
    exit 2
    ;;
esac
