#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""王下七武海俱乐部 · 共享后端（标准库 + SQLite）"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import cos_util
import ocr_util

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "club.db"
STATIC_ROOT = ROOT

ADMIN_USER = os.environ.get("ADMIN_USER", "王下七武海")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "123456")
PORT = int(os.environ.get("PORT", "8765"))
TOKEN_TTL_SEC = int(os.environ.get("TOKEN_TTL_SEC", str(7 * 24 * 3600)))

# 论坛限制
FORUM_TITLE_MAX = 40
FORUM_BODY_MAX = 5000
FORUM_AUTHOR_MAX = 20
FORUM_IMAGE_MAX = 6
FORUM_IMAGE_BYTES = 5 * 1024 * 1024
FORUM_VIDEO_MAX = 1
FORUM_VIDEO_BYTES = 80 * 1024 * 1024
FORUM_POST_COOLDOWN = 300  # 秒

_post_cooldown: dict[str, int] = {}

IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
VIDEO_TYPES = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
}

def uid() -> str:
    return uuid.uuid4().hex[:16]


def now_ts() -> int:
    return int(time.time())


def _normalize_joined_at(val) -> str:
    """入会日期 YYYY-MM-DD；非法则空串。"""
    s = str(val or "").strip()
    if not s:
        return ""
    m = re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})", s)
    if not m:
        return ""
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not (1 <= mo <= 12 and 1 <= d <= 31):
        return ""
    return f"{y:04d}-{mo:02d}-{d:02d}"


def hash_pw(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def get_db() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    conn = get_db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS members (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          squad TEXT NOT NULL DEFAULT '未编组',
          pathway TEXT NOT NULL DEFAULT '歌颂者',
          score INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT '在帮'
        );
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          date TEXT NOT NULL,
          name TEXT NOT NULL,
          note TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS event_records (
          event_id TEXT NOT NULL,
          member_id TEXT NOT NULL,
          status TEXT NOT NULL,
          PRIMARY KEY (event_id, member_id),
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS posts (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          author TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          media TEXT NOT NULL DEFAULT '[]',
          likes INTEGER NOT NULL DEFAULT 0
        );
        """
    )
    conn.commit()
    ensure_forum_schema(conn)
    ensure_squad_schema(conn)
    ensure_org_schema(conn)
    ensure_member_join_schema(conn)
    ensure_event_time_schema(conn)
    ensure_migrate_schema(conn)
    ensure_league_schema(conn)
    conn.commit()
    conn.close()


def ensure_member_join_schema(conn: sqlite3.Connection) -> None:
    """成员入会时间。"""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(members)").fetchall()}
    if "joined_at" not in cols:
        conn.execute("ALTER TABLE members ADD COLUMN joined_at TEXT")


def ensure_event_time_schema(conn: sqlite3.Connection) -> None:
    """活动开始/结束时间 HH:MM。"""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(events)").fetchall()}
    if "start_time" not in cols:
        conn.execute("ALTER TABLE events ADD COLUMN start_time TEXT")
    if "end_time" not in cols:
        conn.execute("ALTER TABLE events ADD COLUMN end_time TEXT")


def _normalize_event_time(val) -> str:
    """规范化为 HH:MM；兼容浏览器 type=time 返回的 HH:MM:SS；空则空串。"""
    s = str(val or "").strip()
    if not s:
        return ""
    m = re.match(r"^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$", s)
    if not m:
        return ""
    h, mi = int(m.group(1)), int(m.group(2))
    if not (0 <= h <= 23 and 0 <= mi <= 59):
        return ""
    return f"{h:02d}:{mi:02d}"


def _normalize_start_time(val) -> str:
    return _normalize_event_time(val)


def ensure_migrate_schema(conn: sqlite3.Connection) -> None:
    """成员待迁队列（跨主/附属俱乐部）。"""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS migrate_queue (
          member_id TEXT PRIMARY KEY,
          from_club_id TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
        """
    )


REGIMENT_IDS = ("一团", "二团", "三团")
SQUAD_TEAM_COUNT = 5
SQUAD_SLOT_COUNT = 6
SQUAD_REGIMENT_CAP = SQUAD_TEAM_COUNT * SQUAD_SLOT_COUNT  # 30
MAIN_CLUB_ID = "main"
MAIN_CLUB_NAME = "王下七武海"


def ensure_org_schema(conn: sqlite3.Connection) -> None:
    """主俱乐部 + 附属俱乐部 + 同盟；成员/活动/编组按 club_id 隔离。"""
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS clubs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'sub',
          note TEXT NOT NULL DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS alliances (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT 0
        );
        """
    )
    main = conn.execute(
        "SELECT id FROM clubs WHERE kind = 'main' LIMIT 1"
    ).fetchone()
    if not main:
        conn.execute(
            """
            INSERT INTO clubs(id, name, kind, note, sort_order, created_at)
            VALUES (?, ?, 'main', '', 0, ?)
            """,
            (MAIN_CLUB_ID, MAIN_CLUB_NAME, now_ts()),
        )
    main_id = MAIN_CLUB_ID
    mrow = conn.execute(
        "SELECT id FROM clubs WHERE kind = 'main' LIMIT 1"
    ).fetchone()
    if mrow:
        main_id = mrow["id"]

    mem_cols = {r[1] for r in conn.execute("PRAGMA table_info(members)").fetchall()}
    if mem_cols and "club_id" not in mem_cols:
        conn.execute("ALTER TABLE members ADD COLUMN club_id TEXT")
    conn.execute(
        "UPDATE members SET club_id = ? WHERE club_id IS NULL OR TRIM(club_id) = ''",
        (main_id,),
    )

    ev_cols = {r[1] for r in conn.execute("PRAGMA table_info(events)").fetchall()}
    if ev_cols and "club_id" not in ev_cols:
        conn.execute("ALTER TABLE events ADD COLUMN club_id TEXT")
    conn.execute(
        "UPDATE events SET club_id = ? WHERE club_id IS NULL OR TRIM(club_id) = ''",
        (main_id,),
    )

    sm_cols = {r[1] for r in conn.execute("PRAGMA table_info(squad_meta)").fetchall()}
    if sm_cols and "club_id" not in sm_cols:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS squad_meta_new (
              club_id TEXT NOT NULL,
              id TEXT NOT NULL,
              title TEXT NOT NULL,
              leader_id TEXT,
              PRIMARY KEY (club_id, id)
            );
            INSERT OR IGNORE INTO squad_meta_new(club_id, id, title, leader_id)
            SELECT '%s', id, title, leader_id FROM squad_meta;
            DROP TABLE squad_meta;
            ALTER TABLE squad_meta_new RENAME TO squad_meta;
            """
            % main_id.replace("'", "''")
        )
    for crow in conn.execute("SELECT id FROM clubs"):
        cid = crow["id"]
        for rid in REGIMENT_IDS:
            conn.execute(
                """
                INSERT OR IGNORE INTO squad_meta(club_id, id, title, leader_id)
                VALUES (?, ?, ?, NULL)
                """,
                (cid, rid, rid),
            )


def get_main_club_id(conn: sqlite3.Connection) -> str:
    ensure_org_schema(conn)
    row = conn.execute(
        "SELECT id FROM clubs WHERE kind = 'main' LIMIT 1"
    ).fetchone()
    return row["id"] if row else MAIN_CLUB_ID


def resolve_club_id(conn: sqlite3.Connection, requested: str | None) -> str:
    ensure_org_schema(conn)
    req = (requested or "").strip()
    if req:
        hit = conn.execute("SELECT id FROM clubs WHERE id = ?", (req,)).fetchone()
        if hit:
            return hit["id"]
    return get_main_club_id(conn)


def club_row(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"],
        "name": r["name"],
        "kind": r["kind"] or "sub",
        "note": r["note"] or "",
        "sortOrder": int(r["sort_order"] or 0),
        "createdAt": int(r["created_at"] or 0),
    }


def list_clubs(conn: sqlite3.Connection) -> list:
    ensure_org_schema(conn)
    return [
        club_row(r)
        for r in conn.execute(
            "SELECT * FROM clubs ORDER BY CASE kind WHEN 'main' THEN 0 ELSE 1 END, sort_order, name, id"
        )
    ]


def alliance_row(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"],
        "name": r["name"],
        "note": r["note"] or "",
        "sortOrder": int(r["sort_order"] or 0),
        "createdAt": int(r["created_at"] or 0),
    }


def list_alliances(conn: sqlite3.Connection) -> list:
    ensure_org_schema(conn)
    return [
        alliance_row(r)
        for r in conn.execute(
            "SELECT * FROM alliances ORDER BY sort_order, name, id"
        )
    ]


def ensure_squad_schema(conn: sqlite3.Connection) -> None:
    cols = {r[1] for r in conn.execute("PRAGMA table_info(members)").fetchall()}
    if cols and "team" not in cols:
        conn.execute("ALTER TABLE members ADD COLUMN team INTEGER")
    if cols and "slot" not in cols:
        conn.execute("ALTER TABLE members ADD COLUMN slot INTEGER")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS squad_meta (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          leader_id TEXT
        )
        """
    )
    for rid in REGIMENT_IDS:
        conn.execute(
            "INSERT OR IGNORE INTO squad_meta(id, title, leader_id) VALUES (?, ?, NULL)",
            (rid, rid),
        )


def _team_slot(val):
    if val is None or val == "":
        return None
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


def load_leader_ids(conn: sqlite3.Connection, club_id: str | None = None) -> set:
    if club_id:
        rows = conn.execute(
            "SELECT leader_id FROM squad_meta WHERE club_id = ? AND leader_id IS NOT NULL AND leader_id != ''",
            (club_id,),
        )
    else:
        rows = conn.execute(
            "SELECT leader_id FROM squad_meta WHERE leader_id IS NOT NULL AND leader_id != ''"
        )
    return {row["leader_id"] for row in rows if row["leader_id"]}


def list_squad_meta(conn: sqlite3.Connection, club_id: str | None = None) -> list:
    ensure_org_schema(conn)
    cid = resolve_club_id(conn, club_id)
    out = []
    for rid in REGIMENT_IDS:
        row = conn.execute(
            "SELECT * FROM squad_meta WHERE club_id = ? AND id = ?",
            (cid, rid),
        ).fetchone()
        if not row:
            out.append({"id": rid, "title": rid, "leaderId": None, "clubId": cid})
            continue
        out.append(
            {
                "id": rid,
                "title": row["title"] or rid,
                "leaderId": row["leader_id"] or None,
                "clubId": cid,
            }
        )
    return out


def clear_slot_occupant(
    conn: sqlite3.Connection,
    squad: str,
    team: int,
    slot: int,
    except_id: str | None = None,
) -> None:
    if except_id:
        conn.execute(
            """
            UPDATE members SET team=NULL, slot=NULL
            WHERE squad=? AND team=? AND slot=? AND id!=?
            """,
            (squad, team, slot, except_id),
        )
    else:
        conn.execute(
            """
            UPDATE members SET team=NULL, slot=NULL
            WHERE squad=? AND team=? AND slot=?
            """,
            (squad, team, slot),
        )


LEAGUE_MODES = {
    "duel": {"label": "俱乐部宣战", "sides": 2},
    "fours": {"label": "四方联赛", "sides": 4},
    "endhunt": {"label": "终末猎杀", "sides": 2},
    "city": {"label": "猎城战", "sides": 4},
    "plateau": {"label": "高原战", "sides": 4},
}

LEAGUE_RULES = {
    "title": "联赛分析计算规则",
    "inputs": [
        "击杀 / 助攻 / 死亡（录入顺序；游戏结算图多为 击杀/死亡/助攻）",
        "玩家伤 / 承伤 / 治疗 / 对怪（游戏图多为 伤/承/治 一组，右侧对怪；支持「3.6万」）",
        "俱乐部总分（结算面板上的公会分，直接录入）",
    ],
    "gameBoard": {
        "note": "结算截图常见一行：昵称 · 击杀/死亡/助攻 · 玩家伤/承伤/治疗 · 对怪。例：某某野兽 1/0/0 3.6万/2.7万/6506 8 → 玩家伤36000、承伤27000、治疗6506、对怪8。",
    },
    "metrics": [
        {
            "id": "kda",
            "label": "KDA",
            "formula": "(击杀 + 助攻) / max(死亡, 1)",
            "note": "死亡为 0 时按 1 计算，避免除零。",
        },
        {
            "id": "participate",
            "label": "参团率",
            "formula": "(击杀 + 助攻) / max(本俱乐部击杀合计, 1)",
            "note": "只在本俱乐部内部比较；终末等多俱乐部同势力时，各俱乐部单独算。",
        },
        {
            "id": "strategyScore",
            "label": "战略分",
            "formula": "100 × (0.35×玩家伤占比 + 0.25×承伤占比 + 0.25×治疗占比 + 0.15×对怪占比)",
            "note": "占比 = 个人数值 / 本俱乐部该项合计；合计为 0 时该项占比按 0。衡量多维贡献，不是纯输出榜。",
        },
        {
            "id": "sideScore",
            "label": "势力合计分",
            "formula": "该势力下各俱乐部「总分」相加",
            "note": "用于势力对比条；与个人战略分无关。",
        },
    ],
    "weights": {
        "dmgPlayer": 0.35,
        "dmgTaken": 0.25,
        "healing": 0.25,
        "dmgMonster": 0.15,
    },
}


def ensure_league_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS league_matches (
          id TEXT PRIMARY KEY,
          date TEXT NOT NULL,
          mode TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          result TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          event_id TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS league_sides (
          id TEXT PRIMARY KEY,
          match_id TEXT NOT NULL,
          name TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS league_clubs (
          id TEXT PRIMARY KEY,
          match_id TEXT NOT NULL,
          side_id TEXT NOT NULL,
          name TEXT NOT NULL,
          score INTEGER NOT NULL DEFAULT 0,
          is_home INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS league_players (
          id TEXT PRIMARY KEY,
          match_id TEXT NOT NULL,
          side_id TEXT NOT NULL,
          club_id TEXT NOT NULL,
          member_id TEXT,
          name TEXT NOT NULL,
          pathway TEXT NOT NULL DEFAULT '',
          kills INTEGER NOT NULL DEFAULT 0,
          assists INTEGER NOT NULL DEFAULT 0,
          deaths INTEGER NOT NULL DEFAULT 0,
          dmg_player INTEGER NOT NULL DEFAULT 0,
          dmg_taken INTEGER NOT NULL DEFAULT 0,
          healing INTEGER NOT NULL DEFAULT 0,
          dmg_monster INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS league_club_memory (
          name TEXT PRIMARY KEY,
          first_date TEXT NOT NULL DEFAULT '',
          last_date TEXT NOT NULL DEFAULT '',
          meet_count INTEGER NOT NULL DEFAULT 0,
          last_score INTEGER NOT NULL DEFAULT 0,
          avg_score REAL NOT NULL DEFAULT 0,
          max_score INTEGER NOT NULL DEFAULT 0,
          home_count INTEGER NOT NULL DEFAULT 0,
          opponent_count INTEGER NOT NULL DEFAULT 0
        );
        """
    )
    lp_cols = {r[1] for r in conn.execute("PRAGMA table_info(league_players)").fetchall()}
    if lp_cols and "pathway" not in lp_cols:
        conn.execute(
            "ALTER TABLE league_players ADD COLUMN pathway TEXT NOT NULL DEFAULT ''"
        )


def _i(val, default: int = 0) -> int:
    try:
        return max(0, int(val if val is not None else default))
    except (TypeError, ValueError):
        return default


def league_player_metrics(p: dict, club_kills: int) -> dict:
    kills = _i(p.get("kills"))
    assists = _i(p.get("assists"))
    deaths = _i(p.get("deaths"))
    kda = round((kills + assists) / max(deaths, 1), 2)
    participate = round((kills + assists) / max(club_kills, 1), 4) if club_kills else 0.0
    return {
        **p,
        "kda": kda,
        "participate": participate,
        "participatePct": str(int(round(participate * 100))) + "%",
    }


def enrich_league_match(conn: sqlite3.Connection, mid: str) -> dict | None:
    m = conn.execute("SELECT * FROM league_matches WHERE id = ?", (mid,)).fetchone()
    if not m:
        return None
    sides = []
    for s in conn.execute(
        "SELECT * FROM league_sides WHERE match_id = ? ORDER BY sort_order, id", (mid,)
    ):
        clubs = []
        side_score = 0
        side_kills = 0
        for c in conn.execute(
            "SELECT * FROM league_clubs WHERE side_id = ? ORDER BY sort_order, id",
            (s["id"],),
        ):
            players_raw = [
                {
                    "id": r["id"],
                    "memberId": r["member_id"],
                    "name": r["name"],
                    "pathway": (r["pathway"] if "pathway" in r.keys() else "") or "",
                    "kills": int(r["kills"] or 0),
                    "assists": int(r["assists"] or 0),
                    "deaths": int(r["deaths"] or 0),
                    "dmgPlayer": int(r["dmg_player"] or 0),
                    "dmgTaken": int(r["dmg_taken"] or 0),
                    "healing": int(r["healing"] or 0),
                    "dmgMonster": int(r["dmg_monster"] or 0),
                }
                for r in conn.execute(
                    "SELECT * FROM league_players WHERE club_id = ? ORDER BY kills DESC, name",
                    (c["id"],),
                )
            ]
            club_kills = sum(p["kills"] for p in players_raw)
            side_kills += club_kills
            tot_dp = sum(p["dmgPlayer"] for p in players_raw) or 1
            tot_dt = sum(p["dmgTaken"] for p in players_raw) or 1
            tot_heal = sum(p["healing"] for p in players_raw) or 1
            tot_dm = sum(p["dmgMonster"] for p in players_raw) or 1
            players = []
            for p in players_raw:
                base = league_player_metrics(p, club_kills)
                strat = (
                    0.35 * (p["dmgPlayer"] / tot_dp)
                    + 0.25 * (p["dmgTaken"] / tot_dt)
                    + 0.25 * (p["healing"] / tot_heal)
                    + 0.15 * (p["dmgMonster"] / tot_dm)
                )
                base["strategyScore"] = round(strat * 100, 1)
                players.append(base)
            score = int(c["score"] or 0)
            side_score += score
            clubs.append(
                {
                    "id": c["id"],
                    "name": c["name"],
                    "score": score,
                    "isHome": bool(c["is_home"]),
                    "sortOrder": int(c["sort_order"] or 0),
                    "players": players,
                }
            )
        sides.append(
            {
                "id": s["id"],
                "name": s["name"],
                "sortOrder": int(s["sort_order"] or 0),
                "totalScore": side_score,
                "totalKills": side_kills,
                "clubs": clubs,
            }
        )
    mode = m["mode"]
    detail = {
        "id": m["id"],
        "date": m["date"],
        "mode": mode,
        "modeLabel": LEAGUE_MODES.get(mode, {}).get("label", mode),
        "title": m["title"] or "",
        "result": m["result"] or "",
        "note": m["note"] or "",
        "eventId": m["event_id"],
        "createdAt": int(m["created_at"] or 0),
        "sides": sides,
    }
    detail["insights"] = build_league_insights(detail)
    return detail


def _side_agg(side: dict) -> dict:
    clubs = side.get("clubs") or []
    players = [p for c in clubs for p in (c.get("players") or [])]
    def _sum(key):
        return sum(int(p.get(key) or 0) for p in players)
    n = len(players)
    kda_vals = [float(p.get("kda") or 0) for p in players]
    return {
        "name": side.get("name") or "",
        "score": int(side.get("totalScore") or 0),
        "clubs": len(clubs),
        "players": n,
        "kills": _sum("kills"),
        "assists": _sum("assists"),
        "deaths": _sum("deaths"),
        "dmgPlayer": _sum("dmgPlayer"),
        "dmgTaken": _sum("dmgTaken"),
        "healing": _sum("healing"),
        "dmgMonster": _sum("dmgMonster"),
        "avgKda": round(sum(kda_vals) / n, 2) if n else 0.0,
        "filledPlayers": sum(
            1
            for p in players
            if any(
                int(p.get(k) or 0) > 0
                for k in (
                    "kills",
                    "assists",
                    "deaths",
                    "dmgPlayer",
                    "dmgTaken",
                    "healing",
                    "dmgMonster",
                )
            )
        ),
    }


def _pct_gap(a: float, b: float) -> float | None:
    if a <= 0 and b <= 0:
        return None
    base = max(a, b, 1)
    return round((a - b) / base * 100, 1)


def build_league_insights(detail: dict) -> dict:
    """数据质量提示 + 敌我差距结论。"""
    warnings: list[str] = []
    conclusions: list[str] = []
    comparisons: list[dict] = []
    sides = detail.get("sides") or []
    if not sides:
        return {
            "warnings": ["未配置任何势力"],
            "conclusions": [],
            "comparisons": [],
            "level": "poor",
        }

    home_side = None
    for s in sides:
        if any(c.get("isHome") for c in (s.get("clubs") or [])):
            home_side = s
            break
    if home_side is None:
        home_side = sides[0]

    aggs = [_side_agg(s) for s in sides]
    home_agg = next((a for a in aggs if a["name"] == home_side.get("name")), aggs[0])
    foe_aggs = [a for a in aggs if a is not home_agg]

    total_players = sum(a["players"] for a in aggs)
    filled = sum(a["filledPlayers"] for a in aggs)
    if total_players == 0:
        warnings.append("尚未录入任何个人战绩，无法做输出/承伤等对比。")
    elif filled == 0:
        warnings.append("个人数据全为 0，请检查是否未填或 OCR 未识别成功。")
    elif filled < total_players * 0.5:
        warnings.append(
            f"仅有 {filled}/{total_players} 人有有效战绩数字，结论仅供参考。"
        )

    for s in sides:
        for c in s.get("clubs") or []:
            cname = c.get("name") or "未命名俱乐部"
            if not int(c.get("score") or 0):
                warnings.append(f"「{cname}」俱乐部评分为 0，请确认是否漏填结算评分。")
            if c.get("isHome") and not (c.get("players") or []):
                warnings.append("本会尚未添加参赛选手。")
            if (not c.get("isHome")) and not (c.get("players") or []):
                warnings.append(f"「{cname}」暂无个人数据，敌我个人对比会偏弱。")

    # 去重警告
    seen = set()
    uniq_warn = []
    for w in warnings:
        if w not in seen:
            seen.add(w)
            uniq_warn.append(w)
    warnings = uniq_warn

    def _cmp_row(label: str, key: str):
        hv = home_agg.get(key) or 0
        if not foe_aggs:
            return
        fv = sum(f.get(key) or 0 for f in foe_aggs) / max(len(foe_aggs), 1)
        # 多方时用「对方平均」；两方时就是对方
        if len(foe_aggs) == 1:
            fv = foe_aggs[0].get(key) or 0
            foe_label = foe_aggs[0]["name"]
        else:
            foe_label = "对方平均"
        gap = _pct_gap(float(hv), float(fv))
        comparisons.append(
            {
                "label": label,
                "home": hv,
                "foe": fv,
                "foeLabel": foe_label,
                "gapPct": gap,
            }
        )
        if gap is None:
            return
        if abs(gap) < 5:
            conclusions.append(f"{label}：双方接近（差距 {gap}%）。")
        elif gap > 0:
            conclusions.append(f"{label}：本会高于{foe_label}约 {gap}%。")
        else:
            conclusions.append(f"{label}：本会低于{foe_label}约 {abs(gap)}%。")

    if foe_aggs and (home_agg["players"] or any(f["players"] for f in foe_aggs) or home_agg["score"] or any(f["score"] for f in foe_aggs)):
        _cmp_row("俱乐部评分", "score")
        if home_agg["players"] or any(f["players"] for f in foe_aggs):
            _cmp_row("击杀", "kills")
            _cmp_row("玩家伤（输出）", "dmgPlayer")
            _cmp_row("承伤", "dmgTaken")
            _cmp_row("治疗", "healing")
            _cmp_row("对怪", "dmgMonster")
            _cmp_row("平均 KDA", "avgKda")

    # 综合结论
    level = "ok"
    if total_players == 0 or filled == 0:
        level = "poor"
        conclusions.insert(0, "数据不足：先补全双方选手与战绩，再看战斗力差距结论。")
    elif warnings:
        level = "partial"
        if not any("高于" in c or "低于" in c for c in conclusions):
            conclusions.append("已有部分数据，结论偏保守；补全对方战绩后对比会更准。")
    else:
        level = "rich"
        # 挑评分与输出各一句做摘要
        score_cmp = next((c for c in comparisons if c["label"] == "俱乐部评分"), None)
        dmg_cmp = next((c for c in comparisons if c["label"] == "玩家伤（输出）"), None)
        bits = []
        if score_cmp and score_cmp.get("gapPct") is not None:
            g = score_cmp["gapPct"]
            bits.append(
                "评分" + ("占优" if g > 5 else ("落后" if g < -5 else "持平"))
            )
        if dmg_cmp and dmg_cmp.get("gapPct") is not None:
            g = dmg_cmp["gapPct"]
            bits.append(
                "输出" + ("更强" if g > 5 else ("更弱" if g < -5 else "接近"))
            )
        if bits:
            conclusions.insert(0, "综合：" + "、".join(bits) + "。")

    return {
        "warnings": warnings[:12],
        "conclusions": conclusions[:14],
        "comparisons": comparisons,
        "level": level,
        "homeName": home_agg["name"],
    }


def rebuild_league_club_memory(conn: sqlite3.Connection) -> None:
    """从全部战报重建俱乐部简史。"""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS league_club_memory (
          name TEXT PRIMARY KEY,
          first_date TEXT NOT NULL DEFAULT '',
          last_date TEXT NOT NULL DEFAULT '',
          meet_count INTEGER NOT NULL DEFAULT 0,
          last_score INTEGER NOT NULL DEFAULT 0,
          avg_score REAL NOT NULL DEFAULT 0,
          max_score INTEGER NOT NULL DEFAULT 0,
          home_count INTEGER NOT NULL DEFAULT 0,
          opponent_count INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    conn.execute("DELETE FROM league_club_memory")
    rows = conn.execute(
        """
        SELECT c.name AS name, c.score AS score, c.is_home AS is_home, m.date AS date
        FROM league_clubs c
        JOIN league_matches m ON m.id = c.match_id
        WHERE TRIM(c.name) != '' AND c.name != '俱乐部'
          AND IFNULL(c.is_home, 0) = 0
          AND c.name NOT IN (
            SELECT DISTINCT name FROM league_clubs WHERE IFNULL(is_home, 0) = 1
          )
        ORDER BY m.date ASC, m.created_at ASC
        """
    ).fetchall()
    mem: dict[str, dict] = {}
    for r in rows:
        name = str(r["name"] or "").strip()
        if not name:
            continue
        score = int(r["score"] or 0)
        date = str(r["date"] or "")
        item = mem.get(name)
        if not item:
            mem[name] = {
                "first_date": date,
                "last_date": date,
                "meet_count": 1,
                "last_score": score,
                "sum_score": score,
                "max_score": score,
                "home_count": 0,
                "opponent_count": 1,
            }
        else:
            item["last_date"] = date or item["last_date"]
            item["meet_count"] += 1
            item["last_score"] = score
            item["sum_score"] += score
            item["max_score"] = max(item["max_score"], score)
            item["opponent_count"] += 1
    for name, item in mem.items():
        avg = item["sum_score"] / max(item["meet_count"], 1)
        conn.execute(
            """
            INSERT INTO league_club_memory(
              name, first_date, last_date, meet_count, last_score, avg_score, max_score,
              home_count, opponent_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                name,
                item["first_date"],
                item["last_date"],
                item["meet_count"],
                item["last_score"],
                round(avg, 1),
                item["max_score"],
                item["home_count"],
                item["opponent_count"],
            ),
        )


def list_league_club_memory(conn: sqlite3.Connection) -> list[dict]:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS league_club_memory (
          name TEXT PRIMARY KEY,
          first_date TEXT NOT NULL DEFAULT '',
          last_date TEXT NOT NULL DEFAULT '',
          meet_count INTEGER NOT NULL DEFAULT 0,
          last_score INTEGER NOT NULL DEFAULT 0,
          avg_score REAL NOT NULL DEFAULT 0,
          max_score INTEGER NOT NULL DEFAULT 0,
          home_count INTEGER NOT NULL DEFAULT 0,
          opponent_count INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    return [
        {
            "name": r["name"],
            "firstDate": r["first_date"] or "",
            "lastDate": r["last_date"] or "",
            "meetCount": int(r["meet_count"] or 0),
            "lastScore": int(r["last_score"] or 0),
            "avgScore": float(r["avg_score"] or 0),
            "maxScore": int(r["max_score"] or 0),
            "homeCount": int(r["home_count"] or 0),
            "opponentCount": int(r["opponent_count"] or 0),
        }
        for r in conn.execute(
            "SELECT * FROM league_club_memory ORDER BY last_date DESC, meet_count DESC, name"
        )
    ]


def league_match_summary(detail: dict) -> dict:
    return {
        "id": detail["id"],
        "date": detail["date"],
        "mode": detail["mode"],
        "modeLabel": detail["modeLabel"],
        "title": detail["title"],
        "result": detail["result"],
        "eventId": detail.get("eventId"),
        "sideNames": [s["name"] for s in detail["sides"]],
        "sideScores": [s["totalScore"] for s in detail["sides"]],
        "playerCount": sum(
            len(c["players"]) for s in detail["sides"] for c in s["clubs"]
        ),
    }


def replace_league_tree(conn: sqlite3.Connection, mid: str, data: dict) -> None:
    conn.execute("DELETE FROM league_players WHERE match_id = ?", (mid,))
    conn.execute("DELETE FROM league_clubs WHERE match_id = ?", (mid,))
    conn.execute("DELETE FROM league_sides WHERE match_id = ?", (mid,))
    sides_in = data.get("sides") if isinstance(data.get("sides"), list) else []
    for si, s in enumerate(sides_in):
        if not isinstance(s, dict):
            continue
        sid = str(s.get("id") or uid())
        sname = (s.get("name") or ("势力" + str(si + 1))).strip()[:40]
        conn.execute(
            "INSERT INTO league_sides(id, match_id, name, sort_order) VALUES (?, ?, ?, ?)",
            (sid, mid, sname, int(s.get("sortOrder", si))),
        )
        clubs_in = s.get("clubs") if isinstance(s.get("clubs"), list) else []
        for ci, c in enumerate(clubs_in):
            if not isinstance(c, dict):
                continue
            cid = str(c.get("id") or uid())
            cname = (c.get("name") or "俱乐部").strip()[:40]
            conn.execute(
                """
                INSERT INTO league_clubs(id, match_id, side_id, name, score, is_home, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    cid,
                    mid,
                    sid,
                    cname,
                    _i(c.get("score")),
                    1 if c.get("isHome") else 0,
                    int(c.get("sortOrder", ci)),
                ),
            )
            players_in = c.get("players") if isinstance(c.get("players"), list) else []
            for p in players_in:
                if not isinstance(p, dict):
                    continue
                pname = (p.get("name") or "").strip()[:40]
                if not pname:
                    continue
                mid_mem = p.get("memberId")
                conn.execute(
                    """
                    INSERT INTO league_players(
                      id, match_id, side_id, club_id, member_id, name, pathway,
                      kills, assists, deaths, dmg_player, dmg_taken, healing, dmg_monster
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(p.get("id") or uid()),
                        mid,
                        sid,
                        cid,
                        (str(mid_mem).strip() if mid_mem else None),
                        pname,
                        str(p.get("pathway") or "").strip()[:20],
                        _i(p.get("kills")),
                        _i(p.get("assists")),
                        _i(p.get("deaths")),
                        _i(p.get("dmgPlayer")),
                        _i(p.get("dmgTaken")),
                        _i(p.get("healing")),
                        _i(p.get("dmgMonster")),
                    ),
                )
    rebuild_league_club_memory(conn)


def ensure_forum_schema(conn: sqlite3.Connection) -> None:
    cols = {r[1] for r in conn.execute("PRAGMA table_info(posts)").fetchall()}
    if cols and "likes" not in cols:
        conn.execute("ALTER TABLE posts ADD COLUMN likes INTEGER NOT NULL DEFAULT 0")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS post_likes (
          post_id TEXT NOT NULL,
          ip TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (post_id, ip)
        )
        """
    )


def normalize_blocks(body, media) -> list:
    """兼容旧帖：body 纯文本 + media 附件 → 上下混排 blocks。"""
    if isinstance(media, list) and media:
        first = media[0] if isinstance(media[0], dict) else {}
        if first.get("type") in ("text", "image", "video"):
            out = []
            for b in media:
                if not isinstance(b, dict):
                    continue
                t = b.get("type")
                if t == "text":
                    txt = str(b.get("text") or "")
                    if txt.strip():
                        out.append({"type": "text", "text": txt})
                elif t in ("image", "video"):
                    url = str(b.get("url") or "").strip()
                    key = str(b.get("key") or "").strip()
                    if url and key:
                        out.append(
                            {
                                "type": t,
                                "url": url,
                                "key": key,
                                "name": str(b.get("name") or "")[:80],
                            }
                        )
            return out
    blocks = []
    if body and str(body).strip():
        blocks.append({"type": "text", "text": str(body)})
    for m in media or []:
        if not isinstance(m, dict):
            continue
        kind = m.get("kind") or m.get("type")
        if kind not in ("image", "video"):
            continue
        url = str(m.get("url") or "").strip()
        key = str(m.get("key") or "").strip()
        if not url or not key:
            continue
        blocks.append(
            {
                "type": kind,
                "url": url,
                "key": key,
                "name": str(m.get("name") or "")[:80],
            }
        )
    return blocks


def blocks_preview(blocks: list) -> str:
    for b in blocks:
        if b.get("type") == "text" and str(b.get("text") or "").strip():
            return str(b.get("text"))
    return ""


def blocks_media_keys(blocks: list) -> list:
    keys = []
    for b in blocks:
        if b.get("type") in ("image", "video") and b.get("key"):
            keys.append(str(b["key"]))
    return keys


def client_ip(handler: SimpleHTTPRequestHandler) -> str:
    xff = handler.headers.get("X-Forwarded-For") or ""
    if xff:
        return xff.split(",")[0].strip()
    return handler.client_address[0] if handler.client_address else "unknown"


def post_row(r: sqlite3.Row, liked: bool = False) -> dict:
    try:
        media = json.loads(r["media"] or "[]")
    except json.JSONDecodeError:
        media = []
    if not isinstance(media, list):
        media = []
    blocks = normalize_blocks(r["body"], media)
    likes = 0
    try:
        likes = int(r["likes"] or 0)
    except (KeyError, IndexError, TypeError, ValueError):
        likes = 0
    preview = blocks_preview(blocks)
    img_n = sum(1 for b in blocks if b.get("type") == "image")
    vid_n = sum(1 for b in blocks if b.get("type") == "video")
    return {
        "id": r["id"],
        "title": r["title"],
        "author": r["author"],
        "createdAt": int(r["created_at"]),
        "blocks": blocks,
        "preview": preview,
        "likes": likes,
        "liked": bool(liked),
        "imageCount": img_n,
        "videoCount": vid_n,
        # 兼容旧前端字段
        "body": preview,
        "media": [b for b in blocks if b.get("type") in ("image", "video")],
    }


def safe_filename(name: str) -> str:
    base = os.path.basename(name or "file")
    base = re.sub(r"[^\w.\u4e00-\u9fff-]+", "_", base)
    return base[:80] or "file"


def member_row(r: sqlite3.Row, leader_ids: set | None = None) -> dict:
    keys = r.keys()
    team = _team_slot(r["team"] if "team" in keys else None)
    slot = _team_slot(r["slot"] if "slot" in keys else None)
    mid = r["id"]
    club_id = ""
    if "club_id" in keys:
        club_id = (r["club_id"] or "") or ""
    joined_at = ""
    if "joined_at" in keys:
        joined_at = (r["joined_at"] or "") or ""
    return {
        "id": mid,
        "name": r["name"],
        "squad": r["squad"],
        "pathway": r["pathway"],
        "score": int(r["score"] or 0),
        "status": r["status"],
        "team": team,
        "slot": slot,
        "clubId": club_id,
        "joinedAt": joined_at,
        "isLeader": bool(leader_ids and mid in leader_ids),
    }


def event_dict(conn: sqlite3.Connection, r: sqlite3.Row) -> dict:
    records = {}
    for row in conn.execute(
        "SELECT member_id, status FROM event_records WHERE event_id = ?", (r["id"],)
    ):
        records[row["member_id"]] = row["status"]
    keys = r.keys()
    club_id = (r["club_id"] if "club_id" in keys else "") or ""
    start_time = ""
    end_time = ""
    if "start_time" in keys:
        start_time = _normalize_event_time(r["start_time"])
    if "end_time" in keys:
        end_time = _normalize_event_time(r["end_time"])
    return {
        "id": r["id"],
        "date": r["date"],
        "name": r["name"],
        "note": r["note"] or "",
        "startTime": start_time,
        "endTime": end_time,
        "clubId": club_id,
        "records": records,
    }


def list_members(conn: sqlite3.Connection, club_id: str | None = None) -> list:
    ensure_org_schema(conn)
    cid = resolve_club_id(conn, club_id)
    leaders = load_leader_ids(conn, cid)
    rows = conn.execute(
        "SELECT * FROM members WHERE club_id = ? ORDER BY pathway, name, id",
        (cid,),
    ).fetchall()
    return [member_row(r, leaders) for r in rows]


def list_events(conn: sqlite3.Connection, club_id: str | None = None) -> list:
    ensure_org_schema(conn)
    ensure_event_time_schema(conn)
    cid = resolve_club_id(conn, club_id)
    rows = conn.execute(
        "SELECT * FROM events WHERE club_id = ? ORDER BY date DESC, COALESCE(start_time, '99:99'), id DESC",
        (cid,),
    ).fetchall()
    return [event_dict(conn, r) for r in rows]


def auth_user(token: str | None) -> str | None:
    if not token:
        return None
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT username, expires_at FROM sessions WHERE token = ?", (token,)
        ).fetchone()
        if not row:
            return None
        if int(row["expires_at"]) < now_ts():
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            conn.commit()
            return None
        return row["username"]
    finally:
        conn.close()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def _club_param(self) -> str | None:
        q = parse_qs(urlparse(self.path).query)
        vals = q.get("clubId") or q.get("club_id") or []
        return (vals[0] if vals else None) or None

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")

    def _json(self, code: int, payload) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self, max_bytes: int = 8_000_000) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > max_bytes:
            # 读完以免连接错乱
            self.rfile.read(length)
            raise ValueError("请求体过大，请压缩截图后再试")
        raw = self.rfile.read(length)
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            return {}

    def _bearer(self) -> str | None:
        h = self.headers.get("Authorization") or ""
        if h.lower().startswith("bearer "):
            return h[7:].strip() or None
        return None

    def _require_admin(self) -> str | None:
        user = auth_user(self._bearer())
        if not user:
            self._json(401, {"error": "未登录或登录已过期"})
            return None
        return user

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/"):
            self.handle_api("GET", path)
            return
        if path == "/":
            self.path = "/index.html"
        return SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api("POST", parsed.path)
            return
        self._json(404, {"error": "not found"})

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api("PUT", parsed.path)
            return
        self._json(404, {"error": "not found"})

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api("DELETE", parsed.path)
            return
        self._json(404, {"error": "not found"})

    def handle_api(self, method: str, path: str) -> None:
        parts = [p for p in path.split("/") if p]
        # parts: ['api', ...]
        try:
            if method == "POST" and path == "/api/login":
                return self.api_login()
            if method == "POST" and path == "/api/logout":
                return self.api_logout()
            if method == "GET" and path == "/api/me":
                return self.api_me()
            if method == "GET" and path == "/api/overview":
                return self.api_overview()
            if method == "GET" and path == "/api/clubs":
                return self.api_clubs_list()
            if method == "POST" and path == "/api/clubs":
                return self.api_clubs_create()
            if method == "PUT" and len(parts) == 3 and parts[1] == "clubs":
                return self.api_clubs_update(parts[2])
            if method == "DELETE" and len(parts) == 3 and parts[1] == "clubs":
                return self.api_clubs_delete(parts[2])
            if method == "GET" and path == "/api/alliances":
                return self.api_alliances_list()
            if method == "POST" and path == "/api/alliances":
                return self.api_alliances_create()
            if method == "PUT" and len(parts) == 3 and parts[1] == "alliances":
                return self.api_alliances_update(parts[2])
            if method == "DELETE" and len(parts) == 3 and parts[1] == "alliances":
                return self.api_alliances_delete(parts[2])
            if method == "GET" and path == "/api/squads":
                return self.api_squads_board()
            if method == "PUT" and path == "/api/squads/meta":
                return self.api_squads_meta()
            if method == "PUT" and path == "/api/squads/assign":
                return self.api_squads_assign()
            if method == "GET" and path == "/api/league/meta":
                return self.api_league_meta()
            if method == "GET" and path == "/api/league/clubs":
                return self.api_league_clubs()
            if method == "POST" and path == "/api/league/ocr":
                return self.api_league_ocr()
            if method == "GET" and path == "/api/league/matches":
                return self.api_league_list()
            if method == "POST" and path == "/api/league/matches":
                return self.api_league_create()
            if method == "GET" and len(parts) == 4 and parts[1] == "league" and parts[2] == "matches":
                return self.api_league_get(parts[3])
            if method == "PUT" and len(parts) == 4 and parts[1] == "league" and parts[2] == "matches":
                return self.api_league_update(parts[3])
            if method == "DELETE" and len(parts) == 4 and parts[1] == "league" and parts[2] == "matches":
                return self.api_league_delete(parts[3])
            if method == "GET" and path == "/api/members":
                return self.api_list_members()
            if method == "GET" and path == "/api/members/migrate-queue":
                return self.api_migrate_queue_list()
            if method == "POST" and path == "/api/members/migrate-queue":
                return self.api_migrate_queue_add()
            if method == "DELETE" and path == "/api/members/migrate-queue":
                return self.api_migrate_queue_remove()
            if method == "POST" and path == "/api/members/migrate":
                return self.api_members_migrate()
            if method == "POST" and path == "/api/members/ocr":
                return self.api_members_ocr()
            if method == "POST" and path == "/api/members/batch":
                return self.api_members_batch()
            if method == "POST" and path == "/api/members":
                return self.api_create_member()
            if method == "PUT" and len(parts) == 3 and parts[1] == "members":
                return self.api_update_member(parts[2])
            if method == "DELETE" and len(parts) == 3 and parts[1] == "members":
                return self.api_delete_member(parts[2])
            if method == "GET" and path == "/api/events":
                return self.api_list_events()
            if method == "POST" and path == "/api/events":
                return self.api_create_event()
            if method == "PUT" and len(parts) == 3 and parts[1] == "events":
                return self.api_update_event(parts[2])
            if method == "DELETE" and len(parts) == 3 and parts[1] == "events":
                return self.api_delete_event(parts[2])
            if method == "PUT" and len(parts) == 4 and parts[1] == "events" and parts[3] == "records":
                return self.api_put_records(parts[2])
            if method == "GET" and path == "/api/export":
                return self.api_export()
            if method == "POST" and path == "/api/import":
                return self.api_import()
            if method == "GET" and path == "/api/forum/meta":
                return self.api_forum_meta()
            if method == "GET" and path == "/api/forum/posts":
                return self.api_forum_list()
            if method == "GET" and len(parts) == 4 and parts[1] == "forum" and parts[2] == "posts":
                return self.api_forum_get(parts[3])
            if method == "POST" and path == "/api/forum/posts":
                return self.api_forum_create()
            if method == "DELETE" and len(parts) == 4 and parts[1] == "forum" and parts[2] == "posts":
                return self.api_forum_delete(parts[3])
            if method == "POST" and path == "/api/forum/upload-sign":
                return self.api_forum_upload_sign()
            if method == "POST" and len(parts) == 5 and parts[1] == "forum" and parts[2] == "posts" and parts[4] == "like":
                return self.api_forum_like(parts[3])
            self._json(404, {"error": "接口不存在"})
        except Exception as exc:  # noqa: BLE001
            self._json(500, {"error": "服务器错误", "detail": str(exc)})

    def api_login(self) -> None:
        data = self._read_json()
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""
        if username == ADMIN_USER and password == ADMIN_PASSWORD:
            token = secrets.token_urlsafe(32)
            conn = get_db()
            conn.execute(
                "INSERT INTO sessions(token, username, expires_at) VALUES (?, ?, ?)",
                (token, username, now_ts() + TOKEN_TTL_SEC),
            )
            conn.commit()
            conn.close()
            self._json(200, {"token": token, "username": username})
            return
        self._json(401, {"error": "账号或密码错误"})

    def api_logout(self) -> None:
        token = self._bearer()
        if token:
            conn = get_db()
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            conn.commit()
            conn.close()
        self._json(200, {"ok": True})

    def api_me(self) -> None:
        user = auth_user(self._bearer())
        if not user:
            self._json(401, {"error": "未登录"})
            return
        self._json(200, {"username": user})

    def api_clubs_list(self) -> None:
        conn = get_db()
        try:
            self._json(200, {"clubs": list_clubs(conn)})
        finally:
            conn.close()

    def api_clubs_create(self) -> None:
        if not self._require_admin():
            return
        data = self._read_json()
        name = (data.get("name") or "").strip()[:40]
        if not name:
            self._json(400, {"error": "俱乐部名称必填"})
            return
        cid = str(data.get("id") or uid())
        note = (data.get("note") or "").strip()[:200]
        conn = get_db()
        try:
            ensure_org_schema(conn)
            conn.execute(
                """
                INSERT INTO clubs(id, name, kind, note, sort_order, created_at)
                VALUES (?, ?, 'sub', ?, ?, ?)
                """,
                (cid, name, note, int(data.get("sortOrder") or 10), now_ts()),
            )
            for rid in REGIMENT_IDS:
                conn.execute(
                    "INSERT OR IGNORE INTO squad_meta(club_id, id, title, leader_id) VALUES (?, ?, ?, NULL)",
                    (cid, rid, rid),
                )
            conn.commit()
            self._json(200, {"club": club_row(conn.execute("SELECT * FROM clubs WHERE id=?", (cid,)).fetchone()), "clubs": list_clubs(conn)})
        finally:
            conn.close()

    def api_clubs_update(self, cid: str) -> None:
        if not self._require_admin():
            return
        cid = unquote(cid)
        data = self._read_json()
        conn = get_db()
        try:
            row = conn.execute("SELECT * FROM clubs WHERE id = ?", (cid,)).fetchone()
            if not row:
                self._json(404, {"error": "俱乐部不存在"})
                return
            name = (data.get("name") if "name" in data else row["name"]) or ""
            name = str(name).strip()[:40]
            if not name:
                self._json(400, {"error": "俱乐部名称必填"})
                return
            note = data.get("note") if "note" in data else row["note"]
            sort_order = data.get("sortOrder") if "sortOrder" in data else row["sort_order"]
            conn.execute(
                "UPDATE clubs SET name=?, note=?, sort_order=? WHERE id=?",
                (name, str(note or "").strip()[:200], int(sort_order or 0), cid),
            )
            conn.commit()
            self._json(200, {"club": club_row(conn.execute("SELECT * FROM clubs WHERE id=?", (cid,)).fetchone()), "clubs": list_clubs(conn)})
        finally:
            conn.close()

    def api_clubs_delete(self, cid: str) -> None:
        if not self._require_admin():
            return
        cid = unquote(cid)
        conn = get_db()
        try:
            row = conn.execute("SELECT * FROM clubs WHERE id = ?", (cid,)).fetchone()
            if not row:
                self._json(404, {"error": "俱乐部不存在"})
                return
            if row["kind"] == "main":
                self._json(400, {"error": "主俱乐部不能删除"})
                return
            n_mem = conn.execute(
                "SELECT COUNT(*) AS c FROM members WHERE club_id = ?", (cid,)
            ).fetchone()["c"]
            n_ev = conn.execute(
                "SELECT COUNT(*) AS c FROM events WHERE club_id = ?", (cid,)
            ).fetchone()["c"]
            if int(n_mem or 0) or int(n_ev or 0):
                self._json(400, {"error": "请先清空该附属俱乐部的成员与活动后再删除"})
                return
            conn.execute("DELETE FROM squad_meta WHERE club_id = ?", (cid,))
            conn.execute("DELETE FROM clubs WHERE id = ?", (cid,))
            conn.commit()
            self._json(200, {"ok": True, "clubs": list_clubs(conn)})
        finally:
            conn.close()

    def api_alliances_list(self) -> None:
        conn = get_db()
        try:
            self._json(200, {"alliances": list_alliances(conn)})
        finally:
            conn.close()

    def api_alliances_create(self) -> None:
        if not self._require_admin():
            return
        data = self._read_json()
        name = (data.get("name") or "").strip()[:40]
        if not name:
            self._json(400, {"error": "同盟名称必填"})
            return
        aid = str(data.get("id") or uid())
        note = (data.get("note") or "").strip()[:300]
        conn = get_db()
        try:
            ensure_org_schema(conn)
            conn.execute(
                "INSERT INTO alliances(id, name, note, sort_order, created_at) VALUES (?, ?, ?, ?, ?)",
                (aid, name, note, int(data.get("sortOrder") or 0), now_ts()),
            )
            conn.commit()
            self._json(200, {"alliance": alliance_row(conn.execute("SELECT * FROM alliances WHERE id=?", (aid,)).fetchone()), "alliances": list_alliances(conn)})
        finally:
            conn.close()

    def api_alliances_update(self, aid: str) -> None:
        if not self._require_admin():
            return
        aid = unquote(aid)
        data = self._read_json()
        conn = get_db()
        try:
            row = conn.execute("SELECT * FROM alliances WHERE id = ?", (aid,)).fetchone()
            if not row:
                self._json(404, {"error": "同盟不存在"})
                return
            name = (data.get("name") if "name" in data else row["name"]) or ""
            name = str(name).strip()[:40]
            if not name:
                self._json(400, {"error": "同盟名称必填"})
                return
            note = data.get("note") if "note" in data else row["note"]
            sort_order = data.get("sortOrder") if "sortOrder" in data else row["sort_order"]
            conn.execute(
                "UPDATE alliances SET name=?, note=?, sort_order=? WHERE id=?",
                (name, str(note or "").strip()[:300], int(sort_order or 0), aid),
            )
            conn.commit()
            self._json(200, {"alliance": alliance_row(conn.execute("SELECT * FROM alliances WHERE id=?", (aid,)).fetchone()), "alliances": list_alliances(conn)})
        finally:
            conn.close()

    def api_alliances_delete(self, aid: str) -> None:
        if not self._require_admin():
            return
        aid = unquote(aid)
        conn = get_db()
        try:
            cur = conn.execute("DELETE FROM alliances WHERE id = ?", (aid,))
            conn.commit()
            if cur.rowcount == 0:
                self._json(404, {"error": "同盟不存在"})
                return
            self._json(200, {"ok": True, "alliances": list_alliances(conn)})
        finally:
            conn.close()

    def api_overview(self) -> None:
        """访客可看的总览聚合（不含完整成员名单）。"""
        conn = get_db()
        try:
            ensure_org_schema(conn)
            cid = resolve_club_id(conn, self._club_param())
            mems = list_members(conn, cid)
            club = conn.execute("SELECT * FROM clubs WHERE id = ?", (cid,)).fetchone()
            club_name = club["name"] if club else MAIN_CLUB_NAME
            overview = {
                "clubId": cid,
                "clubName": club_name,
                "alliances": list_alliances(conn),
                "clubs": list_clubs(conn),
                "totalRegistered": len(mems),
                "totalScoreNum": sum(int(m.get("score") or 0) for m in mems),
                "pathways": {},
                "squads": {"一团": 0, "二团": 0, "三团": 0},
            }
            scored = [int(m.get("score") or 0) for m in mems if int(m.get("score") or 0) > 0]
            overview["avgScoreNum"] = (
                int(round(sum(scored) / len(scored))) if scored else 0
            )
            for m in mems:
                p = m.get("pathway") or "未指定"
                overview["pathways"][p] = overview["pathways"].get(p, 0) + 1
                if m.get("status") == "在帮" and m.get("squad") in overview["squads"]:
                    # 已分到小队号位的才算编入战团席位
                    if m.get("team") and m.get("slot"):
                        overview["squads"][m["squad"]] += 1
            pathways = [
                {"name": k, "value": v}
                for k, v in sorted(
                    overview["pathways"].items(),
                    key=lambda kv: (-kv[1], kv[0]),
                )
            ]
            cap = SQUAD_REGIMENT_CAP
            squads = []
            for name in ("一团", "二团", "三团"):
                count = overview["squads"][name]
                fill = min(100, int(round((count / cap) * 100)))
                squads.append(
                    {
                        "name": name,
                        "fill": fill,
                        "pct": str(fill) + "%",
                        "mem": str(count) + "/" + str(cap),
                    }
                )
            today = time.strftime("%Y-%m-%d")
            active = [
                {
                    "id": e["id"],
                    "date": e["date"],
                    "name": e["name"],
                    "note": e.get("note") or "",
                    "startTime": e.get("startTime") or "",
                    "endTime": e.get("endTime") or "",
                }
                for e in list_events(conn, cid)
                if (e.get("date") or "") >= today
            ]
            active.sort(key=lambda x: (x["date"], x.get("startTime") or "99:99", x["name"]))
            self._json(
                200,
                {
                    "clubId": cid,
                    "clubName": club_name,
                    "clubs": list_clubs(conn),
                    "alliances": list_alliances(conn),
                    "totalRegistered": overview["totalRegistered"],
                    "totalScore": f'{overview["totalScoreNum"]:,}',
                    "totalScoreNum": overview["totalScoreNum"],
                    "avgScore": (
                        f'{overview["avgScoreNum"]:,}'
                        if overview["avgScoreNum"]
                        else "—"
                    ),
                    "avgScoreNum": overview["avgScoreNum"],
                    "pathways": pathways,
                    "readiness": [{"group": club_name, "squads": squads}],
                    "activeEvents": active[:40],
                },
            )
        finally:
            conn.close()

    def api_squads_board(self) -> None:
        """访客可看战团编组（不含档案写权限）。"""
        conn = get_db()
        try:
            cid = resolve_club_id(conn, self._club_param())
            metas = list_squad_meta(conn, cid)
            mems = list_members(conn, cid)
            active = [m for m in mems if m.get("status") == "在帮"]
            seated = sum(
                1
                for m in active
                if m.get("squad") in REGIMENT_IDS and m.get("team") and m.get("slot")
            )
            self._json(
                200,
                {
                    "clubId": cid,
                    "teamCount": SQUAD_TEAM_COUNT,
                    "slotCount": SQUAD_SLOT_COUNT,
                    "regimentCap": SQUAD_REGIMENT_CAP,
                    "totalCap": SQUAD_REGIMENT_CAP * len(REGIMENT_IDS),
                    "seated": seated,
                    "regiments": metas,
                    "members": [
                        {
                            "id": m["id"],
                            "name": m["name"],
                            "squad": m["squad"],
                            "pathway": m["pathway"],
                            "score": m["score"],
                            "team": m.get("team"),
                            "slot": m.get("slot"),
                            "isLeader": m.get("isLeader"),
                            "clubId": m.get("clubId"),
                        }
                        for m in active
                    ],
                },
            )
        finally:
            conn.close()

    def api_squads_meta(self) -> None:
        if not self._require_admin():
            return
        data = self._read_json()
        rid = (data.get("id") or "").strip()
        if rid not in REGIMENT_IDS:
            self._json(400, {"error": "战团无效"})
            return
        title = (data.get("title") if "title" in data else None)
        leader_id = data.get("leaderId") if "leaderId" in data else None
        conn = get_db()
        try:
            cid = resolve_club_id(conn, data.get("clubId") or self._club_param())
            row = conn.execute(
                "SELECT * FROM squad_meta WHERE club_id = ? AND id = ?",
                (cid, rid),
            ).fetchone()
            if not row:
                conn.execute(
                    "INSERT INTO squad_meta(club_id, id, title, leader_id) VALUES (?, ?, ?, NULL)",
                    (cid, rid, rid),
                )
                row = conn.execute(
                    "SELECT * FROM squad_meta WHERE club_id = ? AND id = ?",
                    (cid, rid),
                ).fetchone()
            new_title = row["title"] or rid
            new_leader = row["leader_id"]
            if title is not None:
                new_title = str(title).strip()[:20] or rid
            if "leaderId" in data:
                if leader_id:
                    leader_id = str(leader_id).strip()
                    mem = conn.execute(
                        "SELECT id, squad, club_id FROM members WHERE id = ?",
                        (leader_id,),
                    ).fetchone()
                    if not mem:
                        self._json(400, {"error": "团长成员不存在"})
                        return
                    if mem["squad"] != rid:
                        self._json(400, {"error": "团长须属于该战团"})
                        return
                    if (mem["club_id"] or "") != cid:
                        self._json(400, {"error": "团长须属于当前俱乐部"})
                        return
                    new_leader = leader_id
                else:
                    new_leader = None
            conn.execute(
                "UPDATE squad_meta SET title=?, leader_id=? WHERE club_id=? AND id=?",
                (new_title, new_leader, cid, rid),
            )
            conn.commit()
            self._json(
                200,
                {
                    "regiments": list_squad_meta(conn, cid),
                    "members": list_members(conn, cid),
                },
            )
        finally:
            conn.close()

    def api_squads_assign(self) -> None:
        if not self._require_admin():
            return
        data = self._read_json()
        moves = data.get("moves")
        if not isinstance(moves, list) or not moves:
            self._json(400, {"error": "moves 不能为空"})
            return
        conn = get_db()
        try:
            cid = resolve_club_id(conn, data.get("clubId") or self._club_param())
            for mv in moves:
                if not isinstance(mv, dict):
                    continue
                mid = str(mv.get("memberId") or "").strip()
                if not mid:
                    continue
                row = conn.execute(
                    "SELECT * FROM members WHERE id = ? AND club_id = ?",
                    (mid, cid),
                ).fetchone()
                if not row:
                    self._json(404, {"error": "成员不存在: " + mid})
                    return
                squad = (mv.get("squad") if "squad" in mv else row["squad"]) or "未编组"
                squad = str(squad).strip() or "未编组"
                if squad not in REGIMENT_IDS and squad != "未编组":
                    self._json(400, {"error": "战团无效"})
                    return
                team = _team_slot(mv.get("team")) if "team" in mv else _team_slot(row["team"] if "team" in row.keys() else None)
                slot = _team_slot(mv.get("slot")) if "slot" in mv else _team_slot(row["slot"] if "slot" in row.keys() else None)
                if squad == "未编组":
                    team, slot = None, None
                elif team is not None or slot is not None:
                    if team is None or slot is None:
                        self._json(400, {"error": "小队与号位需同时指定"})
                        return
                    if not (1 <= team <= SQUAD_TEAM_COUNT and 1 <= slot <= SQUAD_SLOT_COUNT):
                        self._json(400, {"error": "小队/号位超出范围"})
                        return
                    clear_slot_occupant(conn, squad, team, slot, except_id=mid)
                else:
                    team, slot = None, None
                conn.execute(
                    "UPDATE members SET squad=?, team=?, slot=? WHERE id=?",
                    (squad, team, slot, mid),
                )
                # 若团长被移出战团，清空团长
                if squad == "未编组" or (team is None):
                    pass
                meta = conn.execute(
                    "SELECT id, club_id FROM squad_meta WHERE leader_id = ?",
                    (mid,),
                ).fetchone()
                if meta and meta["id"] != squad:
                    conn.execute(
                        "UPDATE squad_meta SET leader_id=NULL WHERE club_id=? AND id=?",
                        (meta["club_id"], meta["id"]),
                    )
            conn.commit()
            self._json(
                200,
                {
                    "ok": True,
                    "regiments": list_squad_meta(conn, cid),
                    "members": list_members(conn, cid),
                },
            )
        finally:
            conn.close()

    def api_league_meta(self) -> None:
        self._json(
            200,
            {
                "modes": [
                    {"id": k, "label": v["label"], "sides": v["sides"]}
                    for k, v in LEAGUE_MODES.items()
                ],
                "rules": LEAGUE_RULES,
                "ocrReady": ocr_util.ocr_configured(),
            },
        )

    def api_league_clubs(self) -> None:
        conn = get_db()
        try:
            ensure_league_schema(conn)
            rebuild_league_club_memory(conn)
            conn.commit()
            self._json(200, {"clubs": list_league_club_memory(conn)})
        finally:
            conn.close()

    def api_league_ocr(self) -> None:
        if not self._require_admin():
            return
        try:
            data = self._read_json()
        except ValueError as e:
            self._json(413, {"error": str(e)})
            return
        text = (data.get("text") or "").strip()
        image_b64 = data.get("imageBase64") or data.get("image") or ""
        try:
            if text and not image_b64:
                players, raw_lines = ocr_util.parse_scoreboard_text(text)
                result = {
                    "engine": "text",
                    "players": players,
                    "rawLines": raw_lines[:80],
                    "detectionCount": len(raw_lines),
                }
            elif image_b64:
                if not ocr_util.ocr_configured():
                    self._json(
                        503,
                        {
                            "error": "未配置腾讯云 OCR 密钥",
                            "code": "ocr_not_configured",
                            "fallback": True,
                        },
                    )
                    return
                result = ocr_util.recognize_and_parse(str(image_b64))
            else:
                self._json(400, {"error": "请上传截图或粘贴结算文本"})
                return
        except ocr_util.OcrApiError as e:
            self._json(
                400,
                {
                    "error": str(e),
                    "code": e.code or "tencent_ocr_failed",
                    "fallback": True,
                    "quota": e.is_quota,
                },
            )
            return
        except RuntimeError as e:
            self._json(
                400,
                {
                    "error": str(e),
                    "code": "tencent_ocr_failed",
                    "fallback": True,
                },
            )
            return
        except Exception as e:
            self._json(
                500,
                {
                    "error": "识别失败：" + str(e),
                    "code": "tencent_ocr_failed",
                    "fallback": True,
                },
            )
            return

        # 尽量对齐本会成员：补 memberId / pathway
        conn = get_db()
        try:
            mem_by_name = {
                str(r["name"]): r
                for r in conn.execute("SELECT id, name, pathway FROM members")
            }
        finally:
            conn.close()
        players = []
        for p in result.get("players") or []:
            hit = mem_by_name.get(p.get("name") or "")
            players.append(
                {
                    **p,
                    "memberId": hit["id"] if hit else "",
                    "pathway": (hit["pathway"] if hit else "") or "",
                }
            )
        self._json(
            200,
            {
                "engine": result.get("engine"),
                "players": players,
                "rawLines": result.get("rawLines") or [],
                "detectionCount": result.get("detectionCount") or 0,
                "ocrReady": ocr_util.ocr_configured(),
            },
        )

    def api_league_list(self) -> None:
        conn = get_db()
        try:
            ensure_league_schema(conn)
            rows = conn.execute(
                "SELECT id FROM league_matches ORDER BY date DESC, created_at DESC"
            ).fetchall()
            matches = []
            for r in rows:
                detail = enrich_league_match(conn, r["id"])
                if detail:
                    matches.append(league_match_summary(detail))
            self._json(200, {"matches": matches})
        finally:
            conn.close()

    def api_league_get(self, mid: str) -> None:
        conn = get_db()
        try:
            ensure_league_schema(conn)
            detail = enrich_league_match(conn, mid)
            if not detail:
                self._json(404, {"error": "战报不存在"})
                return
            self._json(200, {"match": detail})
        finally:
            conn.close()

    def api_league_create(self) -> None:
        if not self._require_admin():
            return
        data = self._read_json()
        mode = (data.get("mode") or "").strip()
        if mode not in LEAGUE_MODES:
            self._json(400, {"error": "比赛模式无效"})
            return
        date = (data.get("date") or "").strip()
        if not date:
            self._json(400, {"error": "日期必填"})
            return
        mid = data.get("id") or uid()
        conn = get_db()
        try:
            ensure_league_schema(conn)
            conn.execute(
                """
                INSERT INTO league_matches(id, date, mode, title, result, note, event_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    mid,
                    date,
                    mode,
                    (data.get("title") or "").strip()[:80],
                    (data.get("result") or "").strip()[:40],
                    (data.get("note") or "").strip()[:500],
                    (str(data.get("eventId")).strip() if data.get("eventId") else None),
                    now_ts(),
                ),
            )
            replace_league_tree(conn, mid, data)
            conn.commit()
            detail = enrich_league_match(conn, mid)
            self._json(200, {"match": detail})
        finally:
            conn.close()

    def api_league_update(self, mid: str) -> None:
        if not self._require_admin():
            return
        data = self._read_json()
        conn = get_db()
        try:
            ensure_league_schema(conn)
            row = conn.execute(
                "SELECT * FROM league_matches WHERE id = ?", (mid,)
            ).fetchone()
            if not row:
                self._json(404, {"error": "战报不存在"})
                return
            mode = data.get("mode", row["mode"])
            if mode not in LEAGUE_MODES:
                self._json(400, {"error": "比赛模式无效"})
                return
            date = (data.get("date") if "date" in data else row["date"]) or ""
            date = str(date).strip()
            if not date:
                self._json(400, {"error": "日期必填"})
                return
            title = data.get("title") if "title" in data else row["title"]
            result = data.get("result") if "result" in data else row["result"]
            note = data.get("note") if "note" in data else row["note"]
            event_id = data.get("eventId") if "eventId" in data else row["event_id"]
            conn.execute(
                """
                UPDATE league_matches
                SET date=?, mode=?, title=?, result=?, note=?, event_id=?
                WHERE id=?
                """,
                (
                    date,
                    mode,
                    str(title or "").strip()[:80],
                    str(result or "").strip()[:40],
                    str(note or "").strip()[:500],
                    (str(event_id).strip() if event_id else None),
                    mid,
                ),
            )
            if "sides" in data:
                replace_league_tree(conn, mid, data)
            conn.commit()
            self._json(200, {"match": enrich_league_match(conn, mid)})
        finally:
            conn.close()

    def api_league_delete(self, mid: str) -> None:
        if not self._require_admin():
            return
        conn = get_db()
        try:
            ensure_league_schema(conn)
            conn.execute("DELETE FROM league_players WHERE match_id = ?", (mid,))
            conn.execute("DELETE FROM league_clubs WHERE match_id = ?", (mid,))
            conn.execute("DELETE FROM league_sides WHERE match_id = ?", (mid,))
            cur = conn.execute("DELETE FROM league_matches WHERE id = ?", (mid,))
            rebuild_league_club_memory(conn)
            conn.commit()
            if cur.rowcount == 0:
                self._json(404, {"error": "战报不存在"})
                return
            self._json(200, {"ok": True})
        finally:
            conn.close()

    def api_list_members(self) -> None:
        if not self._require_admin():
            return
        conn = get_db()
        try:
            cid = resolve_club_id(conn, self._club_param())
            self._json(200, {"clubId": cid, "members": list_members(conn, cid)})
        finally:
            conn.close()

    def _migrate_queue_payload(self, conn: sqlite3.Connection) -> dict:
        ensure_migrate_schema(conn)
        ensure_org_schema(conn)
        clubs = {c["id"]: c for c in list_clubs(conn)}
        leaders = load_leader_ids(conn)
        rows = conn.execute(
            """
            SELECT m.*, q.from_club_id AS q_from_club_id, q.created_at AS q_created_at
            FROM migrate_queue q
            JOIN members m ON m.id = q.member_id
            ORDER BY q.created_at DESC, m.name
            """
        ).fetchall()
        items = []
        for r in rows:
            m = member_row(r, leaders)
            from_id = (r["q_from_club_id"] if "q_from_club_id" in r.keys() else "") or m.get("clubId") or ""
            club = clubs.get(from_id) or {}
            items.append(
                {
                    **m,
                    "fromClubId": from_id,
                    "fromClubName": club.get("name") or from_id or "未知",
                    "queuedAt": int(r["q_created_at"] or 0),
                }
            )
        return {"items": items, "count": len(items)}

    def api_migrate_queue_list(self) -> None:
        if not self._require_admin():
            return
        conn = get_db()
        try:
            self._json(200, self._migrate_queue_payload(conn))
        finally:
            conn.close()

    def api_migrate_queue_add(self) -> None:
        if not self._require_admin():
            return
        data = self._read_json()
        ids = data.get("memberIds") or data.get("ids") or []
        if isinstance(ids, str):
            ids = [ids]
        if not isinstance(ids, list) or not ids:
            self._json(400, {"error": "请选择要加入待迁区的成员"})
            return
        conn = get_db()
        try:
            ensure_migrate_schema(conn)
            added = 0
            for mid in ids:
                mid = str(mid or "").strip()
                if not mid:
                    continue
                row = conn.execute("SELECT id, club_id FROM members WHERE id = ?", (mid,)).fetchone()
                if not row:
                    continue
                from_cid = (row["club_id"] or "") or get_main_club_id(conn)
                conn.execute(
                    """
                    INSERT INTO migrate_queue(member_id, from_club_id, created_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(member_id) DO UPDATE SET
                      from_club_id=excluded.from_club_id,
                      created_at=excluded.created_at
                    """,
                    (mid, from_cid, now_ts()),
                )
                added += 1
            conn.commit()
            payload = self._migrate_queue_payload(conn)
            payload["added"] = added
            self._json(200, payload)
        finally:
            conn.close()

    def api_migrate_queue_remove(self) -> None:
        if not self._require_admin():
            return
        data = self._read_json()
        ids = data.get("memberIds") or data.get("ids") or []
        if isinstance(ids, str):
            ids = [ids]
        clear_all = bool(data.get("all"))
        conn = get_db()
        try:
            ensure_migrate_schema(conn)
            if clear_all:
                conn.execute("DELETE FROM migrate_queue")
            elif isinstance(ids, list) and ids:
                for mid in ids:
                    conn.execute(
                        "DELETE FROM migrate_queue WHERE member_id = ?",
                        (str(mid),),
                    )
            else:
                self._json(400, {"error": "请指定要移出待迁区的成员"})
                return
            conn.commit()
            self._json(200, self._migrate_queue_payload(conn))
        finally:
            conn.close()

    def api_members_migrate(self) -> None:
        """将待迁区（或指定成员）迁入目标俱乐部，并移出待迁区。"""
        if not self._require_admin():
            return
        data = self._read_json()
        conn = get_db()
        try:
            ensure_migrate_schema(conn)
            ensure_org_schema(conn)
            ensure_member_join_schema(conn)
            target = resolve_club_id(conn, data.get("targetClubId") or data.get("clubId"))
            club_row = conn.execute("SELECT id, name FROM clubs WHERE id = ?", (target,)).fetchone()
            if not club_row:
                self._json(400, {"error": "目标俱乐部不存在"})
                return
            ids = data.get("memberIds") or data.get("ids") or []
            if isinstance(ids, str):
                ids = [ids]
            if not isinstance(ids, list) or not ids:
                # 默认迁入待迁区全部
                ids = [
                    r["member_id"]
                    for r in conn.execute("SELECT member_id FROM migrate_queue").fetchall()
                ]
            if not ids:
                self._json(400, {"error": "待迁区为空"})
                return

            moved = []
            skipped = []
            for mid in ids:
                mid = str(mid or "").strip()
                if not mid:
                    continue
                row = conn.execute("SELECT * FROM members WHERE id = ?", (mid,)).fetchone()
                if not row:
                    skipped.append({"id": mid, "reason": "不存在"})
                    continue
                keys = row.keys()
                from_cid = (row["club_id"] if "club_id" in keys else "") or ""
                if from_cid == target:
                    # 已在目标俱乐部：仅移出待迁区
                    conn.execute("DELETE FROM migrate_queue WHERE member_id = ?", (mid,))
                    skipped.append({"id": mid, "name": row["name"], "reason": "已在目标俱乐部"})
                    continue
                # 清旧俱乐部编组 / 团长
                conn.execute(
                    "UPDATE squad_meta SET leader_id=NULL WHERE leader_id = ?",
                    (mid,),
                )
                conn.execute(
                    """
                    UPDATE members
                    SET club_id=?, squad=?, team=NULL, slot=NULL
                    WHERE id=?
                    """,
                    (target, "未编组", mid),
                )
                conn.execute("DELETE FROM migrate_queue WHERE member_id = ?", (mid,))
                moved.append(
                    {
                        "id": mid,
                        "name": row["name"],
                        "fromClubId": from_cid,
                        "toClubId": target,
                    }
                )
            conn.commit()
            payload = self._migrate_queue_payload(conn)
            payload["moved"] = moved
            payload["skipped"] = skipped
            payload["targetClubId"] = target
            payload["targetClubName"] = club_row["name"]
            payload["members"] = list_members(conn, target)
            self._json(200, payload)
        finally:
            conn.close()

    def api_create_member(self) -> None:
        if not self._require_admin():
            return
        data = self._read_json()
        name = (data.get("name") or "").strip()
        if not name:
            self._json(400, {"error": "姓名不能为空"})
            return
        mid = data.get("id") or uid()
        joined_at = _normalize_joined_at(data.get("joinedAt") or data.get("joined_at"))
        conn = get_db()
        try:
            ensure_member_join_schema(conn)
            cid = resolve_club_id(conn, data.get("clubId") or self._club_param())
            member = {
                "id": mid,
                "name": name,
                "squad": data.get("squad") or "未编组",
                "pathway": data.get("pathway") or "歌颂者",
                "score": max(0, int(data.get("score") or 0)),
                "status": data.get("status") or "在帮",
                "team": None,
                "slot": None,
                "clubId": cid,
                "joinedAt": joined_at,
                "isLeader": False,
            }
            if member["squad"] not in REGIMENT_IDS and member["squad"] != "未编组":
                member["squad"] = "未编组"
            conn.execute(
                "INSERT INTO members(id, name, squad, pathway, score, status, team, slot, club_id, joined_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)",
                (
                    member["id"],
                    member["name"],
                    member["squad"],
                    member["pathway"],
                    member["score"],
                    member["status"],
                    cid,
                    joined_at or None,
                ),
            )
            conn.commit()
            self._json(200, {"member": member})
        finally:
            conn.close()

    def api_members_ocr(self) -> None:
        """成员名单截图 / 文本 OCR → 候选姓名列表。"""
        if not self._require_admin():
            return
        data = self._read_json()
        text = (data.get("text") or "").strip()
        image_b64 = data.get("imageBase64") or data.get("image") or ""
        try:
            if text:
                candidates, raw_lines = ocr_util.parse_roster_text(text)
                engine = "text"
            else:
                if not image_b64:
                    self._json(400, {"error": "请上传截图或粘贴文本"})
                    return
                if not ocr_util.ocr_configured():
                    self._json(
                        503,
                        {
                            "error": "未配置腾讯云 OCR 密钥",
                            "code": "ocr_not_configured",
                        },
                    )
                    return
                result = ocr_util.recognize_and_parse_roster(str(image_b64))
                candidates = result.get("candidates") or []
                raw_lines = result.get("rawLines") or []
                engine = result.get("engine") or "OCR"
            self._json(
                200,
                {
                    "engine": engine,
                    "candidates": candidates,
                    "rawLines": raw_lines[:80],
                    "ocrReady": ocr_util.ocr_configured(),
                },
            )
        except ocr_util.OcrApiError as e:
            self._json(
                502,
                {
                    "error": e.message or "OCR 失败",
                    "code": e.code or "tencent_ocr_failed",
                },
            )
        except Exception as e:
            self._json(
                500,
                {
                    "error": "识别失败：" + str(e),
                    "code": "tencent_ocr_failed",
                },
            )

    def api_members_batch(self) -> None:
        """批量录入 OCR 识别出的成员（跳过同名）。"""
        if not self._require_admin():
            return
        data = self._read_json()
        items = data.get("members") or data.get("candidates") or []
        if not isinstance(items, list) or not items:
            self._json(400, {"error": "没有可录入的成员"})
            return
        joined_default = _normalize_joined_at(data.get("joinedAt") or data.get("joined_at"))
        conn = get_db()
        try:
            ensure_member_join_schema(conn)
            cid = resolve_club_id(conn, data.get("clubId") or self._club_param())
            existing = {
                (r["name"] or "").strip()
                for r in conn.execute(
                    "SELECT name FROM members WHERE club_id = ?", (cid,)
                ).fetchall()
            }
            created = []
            skipped = []
            for item in items:
                if isinstance(item, str):
                    name = item.strip()
                    pathway = "歌颂者"
                    score = 0
                    joined_at = joined_default
                elif isinstance(item, dict):
                    name = str(item.get("name") or "").strip()
                    pathway = str(item.get("pathway") or "歌颂者").strip() or "歌颂者"
                    score = max(0, int(item.get("score") or 0))
                    joined_at = _normalize_joined_at(
                        item.get("joinedAt") or item.get("joined_at") or joined_default
                    )
                else:
                    continue
                if not name:
                    continue
                if name in existing:
                    skipped.append(name)
                    continue
                mid = uid()
                conn.execute(
                    "INSERT INTO members(id, name, squad, pathway, score, status, team, slot, club_id, joined_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)",
                    (
                        mid,
                        name,
                        "未编组",
                        pathway if pathway in (
                            "歌颂者", "奶妈", "占卜家", "学徒", "战士", "窥秘人"
                        ) else "歌颂者",
                        score,
                        "在帮",
                        cid,
                        joined_at or None,
                    ),
                )
                existing.add(name)
                created.append(
                    {
                        "id": mid,
                        "name": name,
                        "squad": "未编组",
                        "pathway": pathway,
                        "score": score,
                        "status": "在帮",
                        "team": None,
                        "slot": None,
                        "clubId": cid,
                        "joinedAt": joined_at,
                        "isLeader": False,
                    }
                )
            conn.commit()
            self._json(
                200,
                {
                    "created": created,
                    "skipped": skipped,
                    "members": list_members(conn, cid),
                },
            )
        finally:
            conn.close()

    def api_update_member(self, mid: str) -> None:
        if not self._require_admin():
            return
        data = self._read_json()
        conn = get_db()
        try:
            row = conn.execute("SELECT * FROM members WHERE id = ?", (mid,)).fetchone()
            if not row:
                self._json(404, {"error": "成员不存在"})
                return
            name = (data.get("name") if "name" in data else row["name"]) or ""
            name = str(name).strip()
            if not name:
                self._json(400, {"error": "姓名不能为空"})
                return
            ensure_member_join_schema(conn)
            squad = data.get("squad", row["squad"])
            pathway = data.get("pathway", row["pathway"])
            score = max(0, int(data.get("score", row["score"]) or 0))
            status = data.get("status", row["status"])
            keys = row.keys()
            team = _team_slot(row["team"] if "team" in keys else None)
            slot = _team_slot(row["slot"] if "slot" in keys else None)
            joined_at = ""
            if "joined_at" in keys:
                joined_at = (row["joined_at"] or "") or ""
            if "joinedAt" in data or "joined_at" in data:
                joined_at = _normalize_joined_at(data.get("joinedAt", data.get("joined_at")))
            if "team" in data:
                team = _team_slot(data.get("team"))
            if "slot" in data:
                slot = _team_slot(data.get("slot"))
            if squad == "未编组":
                team, slot = None, None
            elif team is not None and slot is not None:
                if not (1 <= team <= SQUAD_TEAM_COUNT and 1 <= slot <= SQUAD_SLOT_COUNT):
                    self._json(400, {"error": "小队/号位超出范围"})
                    return
                clear_slot_occupant(conn, squad, team, slot, except_id=mid)
            else:
                team, slot = None, None
            conn.execute(
                "UPDATE members SET name=?, squad=?, pathway=?, score=?, status=?, team=?, slot=?, joined_at=? WHERE id=?",
                (name, squad, pathway, score, status, team, slot, joined_at or None, mid),
            )
            # 移出战团时清团长
            meta = conn.execute(
                "SELECT id FROM squad_meta WHERE leader_id = ?", (mid,)
            ).fetchone()
            if meta and meta["id"] != squad:
                conn.execute(
                    "UPDATE squad_meta SET leader_id=NULL WHERE id=?",
                    (meta["id"],),
                )
            conn.commit()
            leaders = load_leader_ids(conn)
            club_id = (row["club_id"] if "club_id" in keys else "") or ""
            member = {
                "id": mid,
                "name": name,
                "squad": squad,
                "pathway": pathway,
                "score": score,
                "status": status,
                "team": team,
                "slot": slot,
                "clubId": club_id,
                "joinedAt": joined_at,
                "isLeader": mid in leaders,
            }
            self._json(200, {"member": member})
        finally:
            conn.close()

    def api_delete_member(self, mid: str) -> None:
        if not self._require_admin():
            return
        conn = get_db()
        try:
            cur = conn.execute("DELETE FROM members WHERE id = ?", (mid,))
            conn.execute("DELETE FROM event_records WHERE member_id = ?", (mid,))
            conn.commit()
            if cur.rowcount == 0:
                self._json(404, {"error": "成员不存在"})
                return
            self._json(200, {"ok": True})
        finally:
            conn.close()

    def api_list_events(self) -> None:
        conn = get_db()
        try:
            cid = resolve_club_id(conn, self._club_param())
            self._json(200, {"clubId": cid, "events": list_events(conn, cid)})
        finally:
            conn.close()

    def api_create_event(self) -> None:
        if not self._require_admin():
            return
        data = self._read_json()
        date = (data.get("date") or "").strip()
        name = (data.get("name") or "").strip()
        note = (data.get("note") or "").strip()
        start_time = _normalize_event_time(data.get("startTime") or data.get("start_time"))
        end_time = _normalize_event_time(data.get("endTime") or data.get("end_time"))
        if not date or not name:
            self._json(400, {"error": "日期与活动名称必填"})
            return
        eid = data.get("id") or uid()
        conn = get_db()
        try:
            ensure_event_time_schema(conn)
            cid = resolve_club_id(conn, data.get("clubId") or self._club_param())
            conn.execute(
                "INSERT INTO events(id, date, name, note, club_id, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (eid, date, name, note, cid, start_time or None, end_time or None),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM events WHERE id = ?", (eid,)).fetchone()
            self._json(200, {"event": event_dict(conn, row)})
        finally:
            conn.close()

    def api_update_event(self, eid: str) -> None:
        if not self._require_admin():
            return
        data = self._read_json()
        conn = get_db()
        try:
            ensure_event_time_schema(conn)
            row = conn.execute("SELECT * FROM events WHERE id = ?", (eid,)).fetchone()
            if not row:
                self._json(404, {"error": "活动不存在"})
                return
            keys = row.keys()
            date = (data.get("date") if "date" in data else row["date"]) or ""
            name = (data.get("name") if "name" in data else row["name"]) or ""
            note = data.get("note") if "note" in data else (row["note"] or "")
            if "startTime" in data or "start_time" in data:
                start_time = _normalize_event_time(data.get("startTime", data.get("start_time")))
            elif "start_time" in keys:
                start_time = _normalize_event_time(row["start_time"])
            else:
                start_time = ""
            if "endTime" in data or "end_time" in data:
                end_time = _normalize_event_time(data.get("endTime", data.get("end_time")))
            elif "end_time" in keys:
                end_time = _normalize_event_time(row["end_time"])
            else:
                end_time = ""
            date = str(date).strip()
            name = str(name).strip()
            note = str(note).strip()
            if not date or not name:
                self._json(400, {"error": "日期与活动名称必填"})
                return
            conn.execute(
                "UPDATE events SET date=?, name=?, note=?, start_time=?, end_time=? WHERE id=?",
                (date, name, note, start_time or None, end_time or None, eid),
            )
            conn.commit()
            self._json(200, {"event": event_dict(conn, conn.execute("SELECT * FROM events WHERE id=?", (eid,)).fetchone())})
        finally:
            conn.close()

    def api_delete_event(self, eid: str) -> None:
        if not self._require_admin():
            return
        conn = get_db()
        try:
            conn.execute("DELETE FROM event_records WHERE event_id = ?", (eid,))
            cur = conn.execute("DELETE FROM events WHERE id = ?", (eid,))
            conn.commit()
            if cur.rowcount == 0:
                self._json(404, {"error": "活动不存在"})
                return
            self._json(200, {"ok": True})
        finally:
            conn.close()

    def api_put_records(self, eid: str) -> None:
        if not self._require_admin():
            return
        data = self._read_json()
        records = data.get("records")
        if not isinstance(records, dict):
            self._json(400, {"error": "records 必须是对象"})
            return
        allowed = {"present", "leave", "absent"}
        conn = get_db()
        try:
            row = conn.execute("SELECT id FROM events WHERE id = ?", (eid,)).fetchone()
            if not row:
                self._json(404, {"error": "活动不存在"})
                return
            conn.execute("DELETE FROM event_records WHERE event_id = ?", (eid,))
            for mid, st in records.items():
                if st in allowed:
                    conn.execute(
                        "INSERT INTO event_records(event_id, member_id, status) VALUES (?, ?, ?)",
                        (eid, str(mid), st),
                    )
            conn.commit()
            ev_row = conn.execute("SELECT * FROM events WHERE id = ?", (eid,)).fetchone()
            self._json(200, {"event": event_dict(conn, ev_row)})
        finally:
            conn.close()

    def api_export(self) -> None:
        if not self._require_admin():
            return
        conn = get_db()
        try:
            self._json(
                200,
                {
                    "version": 1,
                    "exportedAt": now_ts(),
                    "members": list_members(conn),
                    "events": list_events(conn),
                },
            )
        finally:
            conn.close()

    def api_import(self) -> None:
        if not self._require_admin():
            return
        data = self._read_json()
        members_in = data.get("members")
        events_in = data.get("events")
        if not isinstance(members_in, list) or not isinstance(events_in, list):
            self._json(400, {"error": "JSON 需包含 members 与 events 数组"})
            return
        allowed = {"present", "leave", "absent"}
        conn = get_db()
        try:
            conn.execute("DELETE FROM event_records")
            conn.execute("DELETE FROM events")
            conn.execute("DELETE FROM members")
            for m in members_in:
                if not isinstance(m, dict):
                    continue
                name = str(m.get("name") or "").strip()
                if not name:
                    continue
                mid = str(m.get("id") or uid())
                ensure_member_join_schema(conn)
                ensure_org_schema(conn)
                cid = resolve_club_id(conn, m.get("clubId") or m.get("club_id"))
                joined_at = _normalize_joined_at(m.get("joinedAt") or m.get("joined_at"))
                conn.execute(
                    "INSERT INTO members(id, name, squad, pathway, score, status, team, slot, club_id, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        mid,
                        name,
                        m.get("squad") or "未编组",
                        m.get("pathway") or "歌颂者",
                        max(0, int(m.get("score") or 0)),
                        m.get("status") or "在帮",
                        _team_slot(m.get("team")),
                        _team_slot(m.get("slot")),
                        cid,
                        joined_at or None,
                    ),
                )
            for ev in events_in:
                if not isinstance(ev, dict):
                    continue
                date = str(ev.get("date") or "").strip()
                name = str(ev.get("name") or "").strip()
                if not date or not name:
                    continue
                eid = str(ev.get("id") or uid())
                note = str(ev.get("note") or "").strip()
                conn.execute(
                    "INSERT INTO events(id, date, name, note) VALUES (?, ?, ?, ?)",
                    (eid, date, name, note),
                )
                records = ev.get("records") if isinstance(ev.get("records"), dict) else {}
                for mid, st in records.items():
                    if st in allowed:
                        conn.execute(
                            "INSERT INTO event_records(event_id, member_id, status) VALUES (?, ?, ?)",
                            (eid, str(mid), st),
                        )
            conn.commit()
            self._json(
                200,
                {"members": list_members(conn), "events": list_events(conn)},
            )
        finally:
            conn.close()


    def api_forum_meta(self) -> None:
        self._json(
            200,
            {
                "limits": {
                    "titleMax": FORUM_TITLE_MAX,
                    "bodyMax": FORUM_BODY_MAX,
                    "authorMax": FORUM_AUTHOR_MAX,
                    "imageMax": FORUM_IMAGE_MAX,
                    "imageMaxMB": FORUM_IMAGE_BYTES // (1024 * 1024),
                    "videoMax": FORUM_VIDEO_MAX,
                    "videoMaxMB": FORUM_VIDEO_BYTES // (1024 * 1024),
                    "cooldownSec": FORUM_POST_COOLDOWN,
                },
                "cosReady": cos_util.cos_configured(),
                "tips": (
                    "腾讯云 COS · 上下图文混排。图片 ≤5MB×6、视频 ≤80MB×1、正文 ≤5000 字。"
                    "昵称必填；发帖免登录；可点赞；他人仅浏览；管理员可删帖。"
                ),
            },
        )

    def api_forum_list(self) -> None:
        ip = client_ip(self)
        conn = get_db()
        try:
            ensure_forum_schema(conn)
            conn.commit()
            rows = conn.execute(
                "SELECT * FROM posts ORDER BY likes DESC, created_at DESC, id DESC LIMIT 200"
            ).fetchall()
            ids = [r["id"] for r in rows]
            liked = set()
            if ids:
                placeholders = ",".join("?" for _ in ids)
                liked = {
                    x["post_id"]
                    for x in conn.execute(
                        f"SELECT post_id FROM post_likes WHERE ip = ? AND post_id IN ({placeholders})",
                        [ip, *ids],
                    )
                }
            self._json(
                200,
                {"posts": [post_row(r, liked=(r["id"] in liked)) for r in rows]},
            )
        finally:
            conn.close()

    def api_forum_get(self, pid: str) -> None:
        pid = unquote(pid)
        ip = client_ip(self)
        conn = get_db()
        try:
            ensure_forum_schema(conn)
            conn.commit()
            row = conn.execute("SELECT * FROM posts WHERE id = ?", (pid,)).fetchone()
            if not row:
                self._json(404, {"error": "帖子不存在"})
                return
            liked = conn.execute(
                "SELECT 1 FROM post_likes WHERE post_id = ? AND ip = ?", (pid, ip)
            ).fetchone()
            self._json(200, {"post": post_row(row, liked=bool(liked))})
        finally:
            conn.close()

    def api_forum_upload_sign(self) -> None:
        if not cos_util.cos_configured():
            self._json(503, {"error": "未配置 COS，请设置 COS_SECRET_ID / COS_SECRET_KEY 等环境变量"})
            return
        data = self._read_json()
        kind = (data.get("kind") or "").strip()
        content_type = (data.get("contentType") or "").strip().lower()
        size = int(data.get("size") or 0)
        filename = safe_filename(str(data.get("filename") or "file"))

        if kind == "image":
            if content_type not in IMAGE_TYPES:
                self._json(400, {"error": "图片仅支持 jpg/png/webp/gif"})
                return
            if size <= 0 or size > FORUM_IMAGE_BYTES:
                self._json(400, {"error": f"图片需 ≤{FORUM_IMAGE_BYTES // (1024 * 1024)}MB"})
                return
            ext = IMAGE_TYPES[content_type]
        elif kind == "video":
            if content_type not in VIDEO_TYPES:
                self._json(400, {"error": "视频仅支持 mp4/webm"})
                return
            if size <= 0 or size > FORUM_VIDEO_BYTES:
                self._json(400, {"error": f"视频需 ≤{FORUM_VIDEO_BYTES // (1024 * 1024)}MB"})
                return
            ext = VIDEO_TYPES[content_type]
        else:
            self._json(400, {"error": "kind 须为 image 或 video"})
            return

        key = f"forum/{time.strftime('%Y%m%d')}/{uid()}{ext}"
        upload_url = cos_util.presigned_put_url(key, content_type, expire=900)
        public_url = cos_util.public_url_for_key(key)
        self._json(
            200,
            {
                "key": key,
                "uploadUrl": upload_url,
                "publicUrl": public_url,
                "contentType": content_type,
                "kind": kind,
                "filename": filename,
            },
        )

    def api_forum_create(self) -> None:
        ip = client_ip(self)
        now = now_ts()
        last = _post_cooldown.get(ip, 0)
        if now - last < FORUM_POST_COOLDOWN:
            wait = FORUM_POST_COOLDOWN - (now - last)
            self._json(429, {"error": f"发帖太频繁，请 {wait} 秒后再试"})
            return

        data = self._read_json()
        title = (data.get("title") or "").strip()
        author = (data.get("author") or "").strip()
        blocks_in = data.get("blocks")
        # 兼容旧客户端
        if not isinstance(blocks_in, list):
            body = (data.get("body") or "").strip()
            media_in = data.get("media") if isinstance(data.get("media"), list) else []
            blocks_in = []
            if body:
                blocks_in.append({"type": "text", "text": body})
            for m in media_in:
                if isinstance(m, dict) and m.get("kind") in ("image", "video"):
                    blocks_in.append(
                        {
                            "type": m.get("kind"),
                            "url": m.get("url"),
                            "key": m.get("key"),
                            "name": m.get("name") or "",
                        }
                    )

        if not title:
            self._json(400, {"error": "请填写标题"})
            return
        if len(title) > FORUM_TITLE_MAX:
            self._json(400, {"error": f"标题不超过 {FORUM_TITLE_MAX} 字"})
            return
        if not author:
            self._json(400, {"error": "请填写昵称"})
            return
        if len(author) > FORUM_AUTHOR_MAX:
            self._json(400, {"error": f"昵称不超过 {FORUM_AUTHOR_MAX} 字"})
            return

        blocks = []
        text_len = 0
        img_n = 0
        vid_n = 0
        for b in blocks_in:
            if not isinstance(b, dict):
                continue
            t = b.get("type")
            if t == "text":
                txt = str(b.get("text") or "")
                if not txt.strip():
                    continue
                text_len += len(txt)
                if text_len > FORUM_BODY_MAX:
                    self._json(400, {"error": f"正文合计不超过 {FORUM_BODY_MAX} 字"})
                    return
                blocks.append({"type": "text", "text": txt})
            elif t in ("image", "video"):
                url = str(b.get("url") or "").strip()
                key = str(b.get("key") or "").strip()
                if not url or not key or not key.startswith("forum/"):
                    continue
                if t == "image":
                    img_n += 1
                    if img_n > FORUM_IMAGE_MAX:
                        self._json(400, {"error": f"图片最多 {FORUM_IMAGE_MAX} 张"})
                        return
                else:
                    vid_n += 1
                    if vid_n > FORUM_VIDEO_MAX:
                        self._json(400, {"error": f"视频最多 {FORUM_VIDEO_MAX} 个"})
                        return
                blocks.append(
                    {
                        "type": t,
                        "url": url,
                        "key": key,
                        "name": str(b.get("name") or "")[:80],
                    }
                )

        if not blocks:
            self._json(400, {"error": "请至少写一段文字或上传图片/视频"})
            return
        if not any(b.get("type") == "text" for b in blocks):
            self._json(400, {"error": "请至少写一段文字说明"})
            return

        preview = blocks_preview(blocks)
        pid = uid()
        conn = get_db()
        try:
            ensure_forum_schema(conn)
            conn.execute(
                "INSERT INTO posts(id, title, body, author, created_at, media, likes) VALUES (?, ?, ?, ?, ?, ?, 0)",
                (pid, title, preview, author, now, json.dumps(blocks, ensure_ascii=False)),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM posts WHERE id = ?", (pid,)).fetchone()
            _post_cooldown[ip] = now
            self._json(200, {"post": post_row(row, liked=False)})
        finally:
            conn.close()

    def api_forum_like(self, pid: str) -> None:
        pid = unquote(pid)
        ip = client_ip(self)
        conn = get_db()
        try:
            ensure_forum_schema(conn)
            row = conn.execute("SELECT * FROM posts WHERE id = ?", (pid,)).fetchone()
            if not row:
                self._json(404, {"error": "帖子不存在"})
                return
            existing = conn.execute(
                "SELECT 1 FROM post_likes WHERE post_id = ? AND ip = ?", (pid, ip)
            ).fetchone()
            if existing:
                conn.execute(
                    "DELETE FROM post_likes WHERE post_id = ? AND ip = ?", (pid, ip)
                )
                conn.execute(
                    "UPDATE posts SET likes = CASE WHEN likes > 0 THEN likes - 1 ELSE 0 END WHERE id = ?",
                    (pid,),
                )
                liked = False
            else:
                conn.execute(
                    "INSERT INTO post_likes(post_id, ip, created_at) VALUES (?, ?, ?)",
                    (pid, ip, now_ts()),
                )
                conn.execute("UPDATE posts SET likes = likes + 1 WHERE id = ?", (pid,))
                liked = True
            conn.commit()
            row = conn.execute("SELECT * FROM posts WHERE id = ?", (pid,)).fetchone()
            self._json(200, {"post": post_row(row, liked=liked)})
        finally:
            conn.close()

    def api_forum_delete(self, pid: str) -> None:
        if not self._require_admin():
            return
        pid = unquote(pid)
        conn = get_db()
        try:
            ensure_forum_schema(conn)
            row = conn.execute("SELECT * FROM posts WHERE id = ?", (pid,)).fetchone()
            if not row:
                self._json(404, {"error": "帖子不存在"})
                return
            post = post_row(row)
            conn.execute("DELETE FROM post_likes WHERE post_id = ?", (pid,))
            conn.execute("DELETE FROM posts WHERE id = ?", (pid,))
            conn.commit()
        finally:
            conn.close()

        for key in blocks_media_keys(post.get("blocks") or []):
            try:
                cos_util.delete_object(str(key))
            except Exception:
                pass
        self._json(200, {"ok": True})



def main() -> None:
    init_db()
    region = (os.environ.get("COS_REGION") or "").strip()
    if region.startswith("aap-"):
        os.environ["COS_REGION"] = "ap-" + region[4:]

    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("=" * 56)
    print("  王下七武海俱乐部 · 共享服务已启动")
    print("  本机访问: http://127.0.0.1:%s/" % PORT)
    print("  局域网:   http://<你的电脑IP>:%s/" % PORT)
    print("  管理员:   %s" % ADMIN_USER)
    print("  数据文件: %s" % DB_PATH)
    print("  COS:      %s" % ("已配置" if cos_util.cos_configured() else "未配置（论坛上传不可用）"))
    print("  OCR:      %s" % ("已配置" if ocr_util.ocr_configured() else "未配置（联赛截图识别不可用）"))
    print("=" * 56)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止服务")


if __name__ == "__main__":
    main()
