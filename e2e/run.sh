#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# End-to-end check of the real Docker image, without a hub:
#   1. builds the image;
#   2. for each phase (encrypted, plain): starts the receiver as Gladys would
#      (same image, `node src/receiver.js`, read-only, the manifest's memory and
#      CPU, no capability, the alias `sia-receiver` on a private network, the
#      env the app builds), then runs e2e/check.mjs in the image (read-only,
#      256 MB, 0.5 CPU): SIA frames over TCP and UDP with their ACKs, then the
#      main app with the SDK's fake Gladys on the real channel;
#   3. starts `node index.js` read-only under 256 MB / 0.5 CPU without Gladys:
#      it must stay up and retry.
# Usage: e2e/run.sh   (Docker needed; leaves nothing behind)
# -----------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=gladys-ajax:e2e
NET=gladys-ajax-e2e
RECEIVER=gladys-ajax-e2e-receiver
MAIN=gladys-ajax-e2e-main
TOKEN="e2e-$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
ENV_FILE="$(mktemp)"
MEMORY_MB=$(node -e 'process.stdout.write(String(require("./gladys-assistant-integration.json").containers[0].memory_mb))' 2>/dev/null ||
  sed -n 's/.*"memory_mb": *\([0-9]*\).*/\1/p' gladys-assistant-integration.json | head -1)
CPU=$(sed -n 's/.*"cpu": *\([0-9.]*\).*/\1/p' gladys-assistant-integration.json | head -1)

cleanup() {
  docker rm -f "$RECEIVER" "$MAIN" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -f "$ENV_FILE"
}
trap cleanup EXIT
cleanup

echo "== Building $IMAGE"
docker build -q -t "$IMAGE" . >/dev/null
docker image ls "$IMAGE" --format 'image {{.Repository}}:{{.Tag}} {{.Size}}'
docker network create "$NET" >/dev/null

run_in_image() {
  docker run --rm --network "$NET" --read-only --memory 256m --cpus 0.5 \
    --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp \
    -e E2E_TOKEN="$TOKEN" \
    -v "$PWD/e2e:/app/e2e:ro" -v "$PWD/test/helpers:/app/test/helpers:ro" \
    "$IMAGE" "$@"
}

status=0
for phase in encrypted plain; do
  echo "== Phase $phase: receiver read-only, ${MEMORY_MB} MB, ${CPU} CPU"
  run_in_image node e2e/check.mjs env "$phase" >"$ENV_FILE"
  docker rm -f "$RECEIVER" >/dev/null 2>&1 || true
  docker run -d --name "$RECEIVER" --network "$NET" --network-alias sia-receiver \
    --read-only --memory "${MEMORY_MB}m" --memory-swap "${MEMORY_MB}m" --cpus "$CPU" \
    --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp \
    --env-file "$ENV_FILE" "$IMAGE" node src/receiver.js >/dev/null
  for _ in $(seq 1 30); do
    logs=$(docker logs "$RECEIVER" 2>&1)
    grep -q 'SIA DC-09 receiver' <<<"$logs" && break
    sleep 0.5
  done
  grep -m1 'SIA DC-09 receiver' <<<"$logs" || { echo "$logs"; exit 1; }
  run_in_image node e2e/check.mjs run "$phase" || status=1
  echo "  receiver: $(docker stats --no-stream --format '{{.MemUsage}} RAM, {{.CPUPerc}} CPU' "$RECEIVER")"
  logs=$(docker logs "$RECEIVER" 2>&1)
  key_hex=$(echo -n 'Gladys-Ajax-e2e!' | od -An -tx1 | tr -d ' \n')
  if grep -qi -e "$key_hex" -e 'Gladys-Ajax-e2e!' <<<"$logs"; then
    echo "  ✖ the key appears in the receiver logs"
    status=1
  fi
  echo "  receiver log: $(grep -c 'Refused a message' <<<"$logs" || true) refusal(s), no key"
done

echo "== Main container without Gladys: read-only, 256 MB, 0.5 CPU"
docker run -d --name "$MAIN" --read-only --memory 256m --memory-swap 256m --cpus 0.5 \
  --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp \
  -e GLADYS_HOST_API_URL=http://127.0.0.1:9 -e GLADYS_INTEGRATION_TOKEN=x \
  -e GLADYS_INTEGRATION_SELECTOR=gladys-ajax "$IMAGE" >/dev/null
sleep 6
if [ "$(docker inspect -f '{{.State.Running}}' "$MAIN")" = true ]; then
  echo "  ✔ still running after 6 s, $(docker stats --no-stream --format '{{.MemUsage}}' "$MAIN")"
  docker logs "$MAIN" 2>&1 | sed -n '1,3s/^/    /p'
else
  echo "  ✖ exited"
  docker logs "$MAIN"
  status=1
fi

[ "$status" = 0 ] && echo "== E2E OK" || echo "== E2E FAILED"
exit "$status"
