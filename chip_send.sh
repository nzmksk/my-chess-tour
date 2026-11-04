# Usage: source chip_send.sh   (not `bash chip_send.sh` — the function and
# exports must land in your current shell), then e.g. `chip_send GET /send/accounts`.
export CHIP_SEND_API_URL=https://staging-api.chip-in.asia/api   # prod: https://api.chip-in.asia/api
read -rp  'CHIP Send API key: '    CHIP_SEND_API_KEY;    export CHIP_SEND_API_KEY
read -rsp 'CHIP Send API secret: ' CHIP_SEND_API_SECRET; export CHIP_SEND_API_SECRET; echo

# chip_send METHOD PATH [JSON_BODY]
chip_send() {
  local epoch checksum
  epoch=$(date +%s)
  # `command node` bypasses Git Bash's `node` -> `winpty node.exe` alias, which
  # fails inside $( ) with "stdout is not a tty" and leaves the checksum empty.
  checksum=$(EPOCH=$epoch command node -e 'process.stdout.write(require("crypto").createHmac("sha512",process.env.CHIP_SEND_API_SECRET).update(process.env.EPOCH+process.env.CHIP_SEND_API_KEY).digest("hex"))')
  [[ $checksum =~ ^[0-9a-f]{128}$ ]] || { echo "checksum not computed: '$checksum'" >&2; return 1; }
  curl -sS -X "$1" "$CHIP_SEND_API_URL$2" \
    -H "Authorization: Bearer $CHIP_SEND_API_KEY" -H "epoch: $epoch" -H "checksum: $checksum" \
    -H 'Content-Type: application/json' ${3:+--data "$3"} -w '\nHTTP %{http_code}\n'
}
