export CHIP_SEND_API_URL=https://staging-api.chip-in.asia/api   # prod: https://api.chip-in.asia/api
read -rp  'CHIP Send API key: '    CHIP_SEND_API_KEY;    export CHIP_SEND_API_KEY
read -rsp 'CHIP Send API secret: ' CHIP_SEND_API_SECRET; export CHIP_SEND_API_SECRET; echo

# chip_send METHOD PATH [JSON_BODY]
chip_send() {
  local epoch checksum
  epoch=$(date +%s)
  checksum=$(EPOCH=$epoch node -e 'process.stdout.write(require("crypto").createHmac("sha512",process.env.CHIP_SEND_API_SECRET).update(process.env.EPOCH+process.env.CHIP_SEND_API_KEY).digest("hex"))')
  curl -sS -X "$1" "$CHIP_SEND_API_URL$2"     -H "Authorization: Bearer $CHIP_SEND_API_KEY" -H "epoch: $epoch" -H "checksum: $checksum"     -H 'Content-Type: application/json' ${3:+--data "$3"} -w '
HTTP %{http_code}
'
}
