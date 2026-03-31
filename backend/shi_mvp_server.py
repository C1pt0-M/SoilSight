#!/usr/bin/env python3
"""
Compatibility wrapper for the legacy backend entrypoint.

Preferred entrypoint: `backend/soilsight_server.py`
"""

from __future__ import annotations

from soilsight_server import main


if __name__ == "__main__":
    raise SystemExit(main())
