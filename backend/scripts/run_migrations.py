"""Apply SQL migrations in backend/migrations against SUPABASE_DB_URL.

Run from backend/:  .\\.venv\\Scripts\\python.exe scripts\\run_migrations.py

Migrations are plain SQL files applied in filename order. All project
migrations are written to be idempotent (IF NOT EXISTS), so re-running is safe.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")

import psycopg


def main() -> None:
    db_url = os.environ.get("SUPABASE_DB_URL", "")
    if not db_url:
        sys.exit("SUPABASE_DB_URL is not set in backend/.env")

    migrations = sorted((BACKEND_DIR / "migrations").glob("*.sql"))
    if not migrations:
        print("No migrations found.")
        return

    with psycopg.connect(db_url) as conn:
        for path in migrations:
            print(f"Applying {path.name} ...")
            conn.execute(path.read_text(encoding="utf-8"))
        conn.commit()
    print(f"Applied {len(migrations)} migration(s) successfully.")


if __name__ == "__main__":
    main()
