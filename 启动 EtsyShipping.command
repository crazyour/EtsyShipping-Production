#!/bin/zsh
set -e
cd "$(dirname "$0")"
echo "正在启动 EtsyShipping Mac Web…"
node server.mjs &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT INT TERM
sleep 1
open "http://127.0.0.1:4188"
echo "网站已打开。关闭此窗口或按 Control+C 即可停止。"
wait $SERVER_PID
