#!/usr/bin/env python3
"""Broadcast validator stub — checks exported manifest + checksum consistency."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path


def main() -> int:
    p = argparse.ArgumentParser(description="Validate LightBeam export artifacts")
    p.add_argument("dir", type=Path, help="Directory with transmission-manifest.json")
    args = p.parse_args()
    manifest_path = args.dir / "transmission-manifest.json"
    if not manifest_path.exists():
        print("missing transmission-manifest.json", file=sys.stderr)
        return 1
    manifest = json.loads(manifest_path.read_text())
    required = [
        "protocol_version",
        "session_id",
        "payload_hash",
        "block_count",
        "block_size",
        "filename",
        "publisher_key_id",
    ]
    missing = [k for k in required if k not in manifest]
    if missing:
        print(f"manifest missing keys: {missing}", file=sys.stderr)
        return 1
    checksum = args.dir / "checksum.sha256"
    if checksum.exists():
        line = checksum.read_text().strip().split()[0]
        if line != manifest["payload_hash"]:
            print("checksum.sha256 does not match manifest.payload_hash", file=sys.stderr)
            return 1
    print("OK — manifest looks consistent")
    print(f"  session={manifest.get('session_id')}")
    print(f"  short fields: blocks={manifest['block_count']}×{manifest['block_size']}")
    print(f"  payload_hash={manifest['payload_hash']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
