from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import aiosqlite

POINTS = {"organic": 3, "plastic": 2, "paper": 1}
MAX_EVENTS = 2000
MAX_RECOGNITIONS = 1000
MAX_SAMPLES = 2000

DEFAULT_SETTINGS: dict[str, Any] = {
    "language": "en",
    "tts_enabled": True,
    "waste_model_path": "/models/waste/",
    "camera_device_id": "",
    "waste_confidence": 0.75,
    "waste_stability_frames": 5,
    "waste_cooldown_ms": 6000,
    "demo_mode": False,
}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _table(mode: str, base: str) -> str:
    if mode not in {"live", "demo"}:
        raise ValueError("mode must be live or demo")
    return base if mode == "live" else f"demo_{base}"


class Database:
    def __init__(self, path: Path):
        self.path = path
        self._db: aiosqlite.Connection | None = None

    async def init(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = await aiosqlite.connect(self.path)
        self._db.row_factory = aiosqlite.Row
        await self._db.execute("PRAGMA journal_mode=WAL")
        await self._db.execute("PRAGMA foreign_keys=ON")
        await self._db.execute("PRAGMA busy_timeout=5000")
        await self._db.executescript(
            """
            CREATE TABLE IF NOT EXISTS events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ts TEXT NOT NULL, mode TEXT NOT NULL, kind TEXT NOT NULL,
              severity TEXT NOT NULL, title TEXT NOT NULL, detail TEXT,
              source TEXT, meta TEXT
            );
            CREATE TABLE IF NOT EXISTS demo_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ts TEXT NOT NULL, mode TEXT NOT NULL, kind TEXT NOT NULL,
              severity TEXT NOT NULL, title TEXT NOT NULL, detail TEXT,
              source TEXT, meta TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_events_live ON events(id DESC);
            CREATE INDEX IF NOT EXISTS idx_events_demo ON demo_events(id DESC);

            CREATE TABLE IF NOT EXISTS recognitions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ts TEXT NOT NULL, mode TEXT NOT NULL, category TEXT NOT NULL,
              confidence REAL NOT NULL, model TEXT, bin_state TEXT,
              bin_alert INTEGER NOT NULL DEFAULT 0,
              indication_confirmed INTEGER NOT NULL DEFAULT 0,
              request_id TEXT NOT NULL, profile_id INTEGER,
              confirmed_disposal INTEGER NOT NULL DEFAULT 0,
              UNIQUE(mode, request_id)
            );
            CREATE TABLE IF NOT EXISTS demo_recognitions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ts TEXT NOT NULL, mode TEXT NOT NULL, category TEXT NOT NULL,
              confidence REAL NOT NULL, model TEXT, bin_state TEXT,
              bin_alert INTEGER NOT NULL DEFAULT 0,
              indication_confirmed INTEGER NOT NULL DEFAULT 0,
              request_id TEXT NOT NULL, profile_id INTEGER,
              confirmed_disposal INTEGER NOT NULL DEFAULT 0,
              UNIQUE(mode, request_id)
            );

            CREATE TABLE IF NOT EXISTS disposals (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ts TEXT NOT NULL, mode TEXT NOT NULL, recognition_id INTEGER NOT NULL,
              profile_id INTEGER, category TEXT NOT NULL, points INTEGER NOT NULL,
              note TEXT, UNIQUE(mode, recognition_id)
            );
            CREATE TABLE IF NOT EXISTS demo_disposals (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ts TEXT NOT NULL, mode TEXT NOT NULL, recognition_id INTEGER NOT NULL,
              profile_id INTEGER, category TEXT NOT NULL, points INTEGER NOT NULL,
              note TEXT, UNIQUE(mode, recognition_id)
            );

            CREATE TABLE IF NOT EXISTS demo_profiles (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL, house_no TEXT NOT NULL, avatar TEXT,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY, value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sensor_samples (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ts TEXT NOT NULL, mode TEXT NOT NULL, soil_pct REAL,
              soil_state TEXT, reservoir_state TEXT, light TEXT,
              bin_organic TEXT, bin_plastic TEXT, bin_paper TEXT
            );
            CREATE TABLE IF NOT EXISTS demo_sensor_samples (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ts TEXT NOT NULL, mode TEXT NOT NULL, soil_pct REAL,
              soil_state TEXT, reservoir_state TEXT, light TEXT,
              bin_organic TEXT, bin_plastic TEXT, bin_paper TEXT
            );
            """
        )
        await self._db.commit()
        await self._prune_all()

    async def close(self) -> None:
        if self._db is not None:
            await self._db.close()
            self._db = None

    @property
    def db(self) -> aiosqlite.Connection:
        if self._db is None:
            raise RuntimeError("database is not open")
        return self._db

    async def _prune_all(self) -> None:
        for mode in ("live", "demo"):
            table = _table(mode, "events")
            await self.db.execute(
                f"DELETE FROM {table} WHERE id NOT IN (SELECT id FROM {table} ORDER BY id DESC LIMIT ?)",
                (MAX_EVENTS,),
            )
            table = _table(mode, "recognitions")
            await self.db.execute(
                f"DELETE FROM {table} WHERE id NOT IN (SELECT id FROM {table} ORDER BY id DESC LIMIT ?)",
                (MAX_RECOGNITIONS,),
            )
            table = _table(mode, "sensor_samples")
            await self.db.execute(
                f"DELETE FROM {table} WHERE id NOT IN (SELECT id FROM {table} ORDER BY id DESC LIMIT ?)",
                (MAX_SAMPLES,),
            )
        await self.db.commit()

    # ------------------------------------------------------------------
    async def add_event(
        self,
        mode: str,
        kind: str,
        title: str,
        detail: str = "",
        severity: str = "info",
        source: str = "backend",
        meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        table = _table(mode, "events")
        ts = utc_now()
        cursor = await self.db.execute(
            f"INSERT INTO {table} (ts, mode, kind, severity, title, detail, source, meta)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (ts, mode, kind, severity, title, detail, source,
             json.dumps(meta or {}, ensure_ascii=False)),
        )
        await self.db.commit()
        return {
            "id": cursor.lastrowid,
            "ts": ts,
            "mode": mode,
            "kind": kind,
            "severity": severity,
            "title": title,
            "detail": detail,
            "source": source,
            "meta": meta or {},
        }

    async def list_events(self, mode: str, limit: int = 100,
                          kind: str | None = None) -> list[dict[str, Any]]:
        table = _table(mode, "events")
        limit = max(1, min(limit, 500))
        sql = f"SELECT * FROM {table}"
        args: list[Any] = []
        if kind:
            sql += " WHERE kind = ?"
            args.append(kind)
        sql += " ORDER BY id DESC LIMIT ?"
        args.append(limit)
        rows = await self.db.execute_fetchall(sql, args)
        result = []
        for row in rows:
            item = dict(row)
            try:
                item["meta"] = json.loads(item["meta"] or "{}")
            except json.JSONDecodeError:
                item["meta"] = {}
            result.append(item)
        return result

    # ------------------------------------------------------------------
    async def add_recognition(
        self,
        mode: str,
        category: str,
        confidence: float,
        model: str,
        bin_state: str,
        bin_alert: bool,
        indication_confirmed: bool,
        request_id: str,
        profile_id: int | None = None,
    ) -> dict[str, Any]:
        table = _table(mode, "recognitions")
        ts = utc_now()
        await self.db.execute(
            f"""INSERT OR IGNORE INTO {table}
            (ts, mode, category, confidence, model, bin_state, bin_alert,
             indication_confirmed, request_id, profile_id, confirmed_disposal)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)""",
            (ts, mode, category, confidence, model, bin_state,
             1 if bin_alert else 0, 1 if indication_confirmed else 0,
             request_id, profile_id),
        )
        await self.db.commit()
        rows = await self.db.execute_fetchall(
            f"SELECT * FROM {table} WHERE mode = ? AND request_id = ?", (mode, request_id)
        )
        return dict(rows[0]) if rows else {}

    async def list_recognitions(self, mode: str, limit: int = 100) -> list[dict[str, Any]]:
        table = _table(mode, "recognitions")
        rows = await self.db.execute_fetchall(
            f"SELECT * FROM {table} ORDER BY id DESC LIMIT ?", (max(1, min(limit, 500)),)
        )
        return [dict(row) for row in rows]

    async def get_recognition(self, mode: str, recognition_id: int) -> dict[str, Any] | None:
        table = _table(mode, "recognitions")
        rows = await self.db.execute_fetchall(
            f"SELECT * FROM {table} WHERE id = ?", (recognition_id,)
        )
        return dict(rows[0]) if rows else None

    async def confirm_disposal(
        self,
        mode: str,
        recognition_id: int,
        profile_id: int | None,
        note: str = "",
    ) -> dict[str, Any]:
        recognition = await self.get_recognition(mode, recognition_id)
        if recognition is None:
            raise ValueError("recognition not found")
        table = _table(mode, "disposals")
        existing = await self.db.execute_fetchall(
            f"SELECT * FROM {table} WHERE mode = ? AND recognition_id = ?",
            (mode, recognition_id),
        )
        if existing:
            return dict(existing[0])
        points = POINTS.get(recognition["category"], 0)
        ts = utc_now()
        cursor = await self.db.execute(
            f"INSERT INTO {table} (ts, mode, recognition_id, profile_id, category, points, note)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (ts, mode, recognition_id, profile_id, recognition["category"], points, note),
        )
        await self.db.execute(
            f"UPDATE {_table(mode, 'recognitions')} SET confirmed_disposal = 1 WHERE id = ?",
            (recognition_id,),
        )
        await self.db.commit()
        return {
            "id": cursor.lastrowid,
            "ts": ts,
            "mode": mode,
            "recognition_id": recognition_id,
            "profile_id": profile_id,
            "category": recognition["category"],
            "points": points,
            "note": note,
        }

    async def list_disposals(self, mode: str, profile_id: int | None = None,
                             limit: int = 200) -> list[dict[str, Any]]:
        table = _table(mode, "disposals")
        if profile_id is None:
            rows = await self.db.execute_fetchall(
                f"SELECT * FROM {table} ORDER BY id DESC LIMIT ?", (limit,)
            )
        else:
            rows = await self.db.execute_fetchall(
                f"SELECT * FROM {table} WHERE profile_id = ? ORDER BY id DESC LIMIT ?",
                (profile_id, limit),
            )
        return [dict(row) for row in rows]

    # ------------------------------------------------------------------
    async def add_profile(self, name: str, house_no: str, avatar: str = "") -> dict[str, Any]:
        ts = utc_now()
        cursor = await self.db.execute(
            "INSERT INTO demo_profiles (name, house_no, avatar, created_at) VALUES (?, ?, ?, ?)",
            (name.strip(), house_no.strip(), avatar.strip(), ts),
        )
        await self.db.commit()
        return {
            "id": cursor.lastrowid,
            "name": name.strip(),
            "house_no": house_no.strip(),
            "avatar": avatar.strip(),
            "created_at": ts,
            "is_fictional": True,
        }

    async def list_profiles(self) -> list[dict[str, Any]]:
        rows = await self.db.execute_fetchall(
            """
            SELECT p.*,
                   COALESCE(SUM(d.points), 0) AS points,
                   COUNT(d.id) AS confirmed_items
            FROM demo_profiles p
            LEFT JOIN demo_disposals d ON d.profile_id = p.id
            GROUP BY p.id
            ORDER BY p.id
            """
        )
        result = []
        for row in rows:
            item = dict(row)
            item["is_fictional"] = True
            result.append(item)
        return result

    async def get_profile(self, profile_id: int) -> dict[str, Any] | None:
        rows = await self.db.execute_fetchall(
            "SELECT * FROM demo_profiles WHERE id = ?", (profile_id,)
        )
        if not rows:
            return None
        profile = dict(rows[0])
        profile["is_fictional"] = True
        profile["disposals"] = await self.list_disposals("demo", profile_id)
        profile["points"] = sum(item["points"] for item in profile["disposals"])
        return profile

    # ------------------------------------------------------------------
    async def get_settings(self) -> dict[str, Any]:
        rows = await self.db.execute_fetchall("SELECT key, value FROM settings")
        stored: dict[str, Any] = {}
        for row in rows:
            try:
                stored[row["key"]] = json.loads(row["value"])
            except json.JSONDecodeError:
                continue
        merged = dict(DEFAULT_SETTINGS)
        merged.update(stored)
        return merged

    async def put_settings(self, values: dict[str, Any]) -> dict[str, Any]:
        for key, value in values.items():
            if key not in DEFAULT_SETTINGS or value is None:
                continue
            await self.db.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?)"
                " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, json.dumps(value, ensure_ascii=False)),
            )
        await self.db.commit()
        return await self.get_settings()

    # ------------------------------------------------------------------
    async def add_sensor_sample(self, mode: str, status: dict[str, Any]) -> None:
        table = _table(mode, "sensor_samples")
        sensors = status.get("sensors", {})
        soil = sensors.get("soil", {})
        reservoir = sensors.get("reservoir", {})
        light = sensors.get("light", {})
        bins = {item.get("id"): item.get("state") for item in sensors.get("bins", [])}
        await self.db.execute(
            f"""INSERT INTO {table}
            (ts, mode, soil_pct, soil_state, reservoir_state, light,
             bin_organic, bin_plastic, bin_paper)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                utc_now(),
                mode,
                soil.get("percent"),
                soil.get("state"),
                reservoir.get("state"),
                light.get("brightness"),
                bins.get("organic"),
                bins.get("plastic"),
                bins.get("paper"),
            ),
        )
        await self.db.commit()
        await self.db.execute(
            f"DELETE FROM {table} WHERE id NOT IN (SELECT id FROM {table} ORDER BY id DESC LIMIT ?)",
            (MAX_SAMPLES,),
        )
        await self.db.commit()

    async def sensor_history(self, mode: str, minutes: int = 30) -> list[dict[str, Any]]:
        table = _table(mode, "sensor_samples")
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=max(1, minutes))).strftime(
            "%Y-%m-%dT%H:%M:%S.%f"
        )[:-3] + "Z"
        rows = await self.db.execute_fetchall(
            f"SELECT * FROM {table} WHERE ts >= ? ORDER BY id ASC", (cutoff,)
        )
        return [dict(row) for row in rows]
