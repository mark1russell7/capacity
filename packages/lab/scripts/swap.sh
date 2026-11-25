#!/usr/bin/env bash
# This script gives the runner a swap of at least the bytes of its argument. It adds a swap file when the runner has less.
# Some runners have no swap. The check child of a start case refuses a host with less swap than its target (planSwap).
# The workflows lab.yml and start-gate.yml start it with the swap of the matrix entry.
set -euo pipefail
need="${1:?The script needs the swap in bytes.}"
case "$need" in
  ''|*[!0-9]*) echo "The swap is not a whole number of bytes: $need." >&2; exit 1 ;;
esac
have=$(awk '/^SwapTotal:/ { print $2 * 1024 }' /proc/meminfo)
if [ "$have" -lt "$need" ]; then
  # the header of a swap file takes one page, thus the file has 1 MiB more
  add=$(( (need - have + 1048575) / 1048576 + 1 ))
  sudo fallocate -l "${add}M" /lab.swap
  sudo chmod 600 /lab.swap
  sudo mkswap /lab.swap
  sudo swapon /lab.swap
fi
