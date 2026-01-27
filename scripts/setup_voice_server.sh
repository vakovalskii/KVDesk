#!/usr/bin/env bash
set -euo pipefail

echo "[voice] Setting up local transcription server..."

PORT="${PORT:-8000}"
HOST="${HOST:-0.0.0.0}"
# IMPORTANT: the Docker image's /v1/models does NOT include `Systran/faster-whisper-large-v3-turbo`,
# which causes the built-in Gradio UI to crash with AssertionError.
# This model id is present in /v1/models on `latest-cpu` and works well as a default.
MODEL="${MODEL:-Systran/faster-whisper-small}"
DEVICE="${DEVICE:-cpu}"
COMPUTE_TYPE="${COMPUTE_TYPE:-int8}"
GIT_URL="${GIT_URL:-https://github.com/fedirz/faster-whisper-server}"
DOCKER_IMAGE="${DOCKER_IMAGE:-fedirz/faster-whisper-server}"
# Docker Hub repo has tags like `latest-cpu` / `latest-cuda` (not plain `latest`)
DOCKER_TAG="${DOCKER_TAG:-latest-cpu}"
DOCKER_FIRST="${DOCKER_FIRST:-1}"
DOCKER_DETACH="${DOCKER_DETACH:-1}"
DOCKER_NAME="${DOCKER_NAME:-localdesk-voice}"
DOCKER_MEMORY="${DOCKER_MEMORY:-5g}"
DOCKER_CPUS="${DOCKER_CPUS:-8}"
DOCKER_SHM_SIZE="${DOCKER_SHM_SIZE:-}"

# Optional: allow passing memory limit as first arg, e.g. ./scripts/setup_voice_server.sh 8g
if [ -n "${1:-}" ]; then
  DOCKER_MEMORY="$1"
fi

port_is_taken() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "${port}" >/dev/null 2>&1
    return $?
  fi
  return 1
}

find_free_port() {
  local start_port="$1"
  local p="$start_port"
  local i=0
  while [ $i -lt 50 ]; do
    if ! port_is_taken "$p"; then
      echo "$p"
      return 0
    fi
    p=$((p + 1))
    i=$((i + 1))
  done
  return 1
}

docker_existing_voice_container_for_port() {
  local port="$1"
  local image="${DOCKER_IMAGE}:${DOCKER_TAG}"
  # Match both IPv4/IPv6 published forms by searching for `:${PORT}->8000`
  docker ps --format '{{.ID}}\t{{.Image}}\t{{.Ports}}' 2>/dev/null \
    | awk -v img="$image" -v needle=":${port}->8000" '$2==img && index($0, needle)>0 { print $1; exit }'
}

ensure_brew_pkg() {
  local pkg="$1"
  if command -v brew >/dev/null 2>&1; then
    if ! brew list "$pkg" >/dev/null 2>&1; then
      echo "[voice] Installing ${pkg} via Homebrew..."
      brew install "$pkg"
    fi
  fi
}

# ffmpeg is strongly recommended (format support / decoding)
if ! command -v ffmpeg >/dev/null 2>&1; then
  if ! command -v brew >/dev/null 2>&1; then
    echo "[voice] WARNING: ffmpeg not found and brew is unavailable. Install ffmpeg manually."
  else
    ensure_brew_pkg ffmpeg
  fi
fi

if [ "$DOCKER_FIRST" = "1" ] && command -v docker >/dev/null 2>&1; then
  echo "[voice] Preferred mode: Docker"

  if port_is_taken "$PORT"; then
    EXISTING_ID="$(docker_existing_voice_container_for_port "$PORT" || true)"
    if [ -n "${EXISTING_ID:-}" ]; then
      echo "[voice] Port ${PORT} is already in use by an existing ${DOCKER_IMAGE}:${DOCKER_TAG} container (${EXISTING_ID})."
      echo "[voice] Reusing it."
      echo "[voice] Base URL for LocalDesk: http://localhost:${PORT}/v1"
      echo "[voice] Tip: open http://localhost:${PORT}/docs"
      exit 0
    fi

    FREE_PORT="$(find_free_port "$PORT" || true)"
    if [ -z "${FREE_PORT:-}" ]; then
      echo "[voice] ERROR: port ${PORT} is busy and no free port found in the next 50 ports."
      echo "[voice] Tip: set PORT=8001 (or stop the service using ${PORT})."
      exit 1
    fi
    echo "[voice] Port ${PORT} is busy. Using free port ${FREE_PORT} instead."
    PORT="$FREE_PORT"
  fi

  echo "[voice] Starting Docker container ${DOCKER_IMAGE}:${DOCKER_TAG} on http://localhost:${PORT}"
  echo "[voice] Docker limits: memory=${DOCKER_MEMORY:-unset} cpus=${DOCKER_CPUS:-unset} shm=${DOCKER_SHM_SIZE:-unset}"
  echo "[voice] Base URL for LocalDesk: http://localhost:${PORT}/v1"
  echo "[voice] Tip: open http://localhost:${PORT}/docs"

  DOCKER_LIMIT_ARGS=()
  if [ -n "${DOCKER_MEMORY}" ]; then
    DOCKER_LIMIT_ARGS+=(--memory "${DOCKER_MEMORY}")
  fi
  if [ -n "${DOCKER_CPUS}" ]; then
    DOCKER_LIMIT_ARGS+=(--cpus "${DOCKER_CPUS}")
  fi
  if [ -n "${DOCKER_SHM_SIZE}" ]; then
    DOCKER_LIMIT_ARGS+=(--shm-size "${DOCKER_SHM_SIZE}")
  fi

  if [ "${DOCKER_DETACH}" = "1" ]; then
    # Run in background so it doesn't die when the terminal closes.
    docker rm -f "${DOCKER_NAME}" >/dev/null 2>&1 || true
    docker run -d --name "${DOCKER_NAME}" -p "${PORT}:8000" \
      "${DOCKER_LIMIT_ARGS[@]}" \
      -e "WHISPER__MODEL=${MODEL}" \
      -e "WHISPER__INFERENCE_DEVICE=${DEVICE}" \
      -e "WHISPER__COMPUTE_TYPE=${COMPUTE_TYPE}" \
      "${DOCKER_IMAGE}:${DOCKER_TAG}" >/dev/null
    echo "[voice] Container '${DOCKER_NAME}' started in background."
    echo "[voice] Follow logs: docker logs -f ${DOCKER_NAME}"
    exit 0
  fi

  exec docker run --rm -p "${PORT}:8000" \
    "${DOCKER_LIMIT_ARGS[@]}" \
    -e "WHISPER__MODEL=${MODEL}" \
    -e "WHISPER__INFERENCE_DEVICE=${DEVICE}" \
    -e "WHISPER__COMPUTE_TYPE=${COMPUTE_TYPE}" \
    "${DOCKER_IMAGE}:${DOCKER_TAG}"
fi

echo "[voice] Preferred mode: uvx (no global Python installs)."
echo "[voice] NOTE: faster-whisper-server is often NOT published on PyPI; we install from Git: ${GIT_URL}"
if command -v uvx >/dev/null 2>&1; then
  echo "[voice] Starting faster-whisper-server via uvx (from git) on http://localhost:${PORT}"
  echo "[voice] Base URL for LocalDesk: http://localhost:${PORT}/v1"
  echo "[voice] Tip: open http://localhost:${PORT}/docs"
  exec uvx --from "git+${GIT_URL}" faster-whisper-server \
    --host "$HOST" --port "$PORT" \
    --model "$MODEL" --device "$DEVICE" --compute_type "$COMPUTE_TYPE"
fi

if command -v brew >/dev/null 2>&1; then
  # uv installs uvx as well
  ensure_brew_pkg uv
  if command -v uvx >/dev/null 2>&1; then
    echo "[voice] Starting faster-whisper-server via uvx (from git) on http://localhost:${PORT}"
    echo "[voice] Base URL for LocalDesk: http://localhost:${PORT}/v1"
    echo "[voice] Tip: open http://localhost:${PORT}/docs"
    exec uvx --from "git+${GIT_URL}" faster-whisper-server \
      --host "$HOST" --port "$PORT" \
      --model "$MODEL" --device "$DEVICE" --compute_type "$COMPUTE_TYPE"
  fi
fi

echo "[voice] uvx is unavailable or failed."
if command -v docker >/dev/null 2>&1; then
  echo "[voice] Starting Docker container ${DOCKER_IMAGE}:${DOCKER_TAG} on http://localhost:${PORT}"
  echo "[voice] Base URL for LocalDesk: http://localhost:${PORT}/v1"
  echo "[voice] Tip: open http://localhost:${PORT}/docs"
  exec docker run --rm -p "${PORT}:8000" \
    -e "WHISPER__MODEL=${MODEL}" \
    -e "WHISPER__INFERENCE_DEVICE=${DEVICE}" \
    -e "WHISPER__COMPUTE_TYPE=${COMPUTE_TYPE}" \
    "${DOCKER_IMAGE}:${DOCKER_TAG}"
fi

echo "[voice] uvx is unavailable. Falling back to venv + pip."
echo "[voice] NOTE: faster-whisper-server often requires Python >= 3.10/3.11."

PYTHON_BIN="${PYTHON_BIN:-}"
if [ -z "$PYTHON_BIN" ]; then
  if command -v python3.11 >/dev/null 2>&1; then
    PYTHON_BIN="python3.11"
  elif command -v python3.10 >/dev/null 2>&1; then
    PYTHON_BIN="python3.10"
  elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
  else
    echo "[voice] ERROR: python3 not found"
    exit 1
  fi
fi

VENV_DIR="${VENV_DIR:-venv_voice}"
if [ ! -d "$VENV_DIR" ]; then
  echo "[voice] Creating venv (${PYTHON_BIN}): $VENV_DIR"
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

echo "[voice] Activating venv..."
# shellcheck disable=SC1090
source "$VENV_DIR/bin/activate"

echo "[voice] Upgrading pip..."
python -m pip install --upgrade pip

echo "[voice] Installing faster-whisper-server..."
python -m pip install --upgrade "faster-whisper-server @ git+${GIT_URL}"

echo "[voice] Starting server on http://localhost:${PORT}"
echo "[voice] Base URL for LocalDesk: http://localhost:${PORT}/v1"
exec faster-whisper-server --host "$HOST" --port "$PORT" --model "$MODEL" --device "$DEVICE" --compute_type "$COMPUTE_TYPE"


