#!/usr/bin/env bash
set -euo pipefail

docker exec mayue-ollama ollama pull qwen3:30b
