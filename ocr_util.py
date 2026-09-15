# -*- coding: utf-8 -*-
"""腾讯云 OCR + 联赛结算图解析（纯标准库）"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Optional


HEADER_WORDS = (
    "击杀",
    "助攻",
    "死亡",
    "伤害",
    "承伤",
    "治疗",
    "对怪",
    "玩家",
    "昵称",
    "名称",
    "角色",
    "排名",
    "积分",
    "职业",
    "KDA",
    "输出",
    "战绩",
    "结算",
)

SKIP_NAME_RE = re.compile(
    r"^(合计|总计|平均|排名|名次|俱乐部|公会|联盟|我方|敌方|对方|胜利|失败|MVP)$"
)
NUM_TOKEN_RE = re.compile(r"^[\d,.\s]+%?$")
INT_FIND_RE = re.compile(r"\d{1,3}(?:,\d{3})+|\d+")
# 游戏结算常见：3.6万 / 2.7万 / 6506
STAT_NUM_RE = re.compile(r"(\d+(?:\.\d+)?)\s*([万亿Ww]?)", re.UNICODE)


class OcrApiError(RuntimeError):
    def __init__(self, code: str, message: str):
        self.code = code or ""
        self.message = message or "OCR 失败"
        super().__init__(f"OCR 失败：{self.code} {self.message}".strip())

    @property
    def is_quota(self) -> bool:
        blob = (self.code + " " + self.message).lower()
        keys = (
            "limitexceeded",
            "resourceinsufficient",
            "resourcesexhausted",
            "quota",
            "exceed",
            "欠费",
            "次数",
            "额度",
            "不足",
            "免费",
            "accountarrears",
        )
        return any(k in blob for k in keys)


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def ocr_secret() -> tuple[str, str]:
    sid = _env("OCR_SECRET_ID") or _env("COS_SECRET_ID")
    skey = _env("OCR_SECRET_KEY") or _env("COS_SECRET_KEY")
    return sid, skey


def ocr_configured() -> bool:
    sid, skey = ocr_secret()
    return bool(sid and skey)


def _normalize_region(region: str) -> str:
    if region.startswith("aap-"):
        return "ap-" + region[4:]
    return region or "ap-shanghai"


def _sha256_hex(msg: bytes | str) -> str:
    if isinstance(msg, str):
        msg = msg.encode("utf-8")
    return hashlib.sha256(msg).hexdigest()


def _hmac_sha256(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _tc3_request(action: str, payload: dict, version: str = "2018-11-19") -> dict:
    secret_id, secret_key = ocr_secret()
    if not secret_id or not secret_key:
        raise RuntimeError("未配置 OCR / COS 密钥")

    service = "ocr"
    host = "ocr.tencentcloudapi.com"
    region = _normalize_region(_env("OCR_REGION") or _env("COS_REGION") or "ap-shanghai")
    algorithm = "TC3-HMAC-SHA256"
    timestamp = int(time.time())
    date = datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime("%Y-%m-%d")
    http_request_method = "POST"
    canonical_uri = "/"
    canonical_querystring = ""
    ct = "application/json; charset=utf-8"
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    payload_bytes = body.encode("utf-8")
    canonical_headers = (
        f"content-type:{ct}\nhost:{host}\nx-tc-action:{action.lower()}\n"
    )
    signed_headers = "content-type;host;x-tc-action"
    hashed_request_payload = _sha256_hex(payload_bytes)
    canonical_request = (
        f"{http_request_method}\n{canonical_uri}\n{canonical_querystring}\n"
        f"{canonical_headers}\n{signed_headers}\n{hashed_request_payload}"
    )
    credential_scope = f"{date}/{service}/tc3_request"
    string_to_sign = (
        f"{algorithm}\n{timestamp}\n{credential_scope}\n{_sha256_hex(canonical_request)}"
    )
    secret_date = _hmac_sha256(("TC3" + secret_key).encode("utf-8"), date)
    secret_service = _hmac_sha256(secret_date, service)
    secret_signing = _hmac_sha256(secret_service, "tc3_request")
    signature = hmac.new(
        secret_signing, string_to_sign.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    authorization = (
        f"{algorithm} "
        f"Credential={secret_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, "
        f"Signature={signature}"
    )

    req = urllib.request.Request(
        f"https://{host}/",
        data=payload_bytes,
        method="POST",
    )
    req.add_header("Content-Type", ct)
    req.add_header("Host", host)
    req.add_header("X-TC-Action", action)
    req.add_header("X-TC-Version", version)
    req.add_header("X-TC-Timestamp", str(timestamp))
    req.add_header("X-TC-Region", region)
    req.add_header("Authorization", authorization)

    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        try:
            data = json.loads(err_body)
        except json.JSONDecodeError:
            raise RuntimeError(f"OCR HTTP {e.code}: {err_body[:200]}") from e

    if "Response" in data and data["Response"].get("Error"):
        err = data["Response"]["Error"]
        code = str(err.get("Code") or "")
        message = str(err.get("Message") or "")
        raise OcrApiError(code, message)
    return data.get("Response") or data


def recognize_image_base64(image_b64: str) -> dict:
    """调用高精度 OCR；失败时回退基础版。"""
    clean = image_b64.strip()
    if "," in clean and clean.lower().startswith("data:"):
        clean = clean.split(",", 1)[1]
    clean = re.sub(r"\s+", "", clean)
    if not clean:
        raise RuntimeError("图片为空")
    # 约 4MB 原始图 → base64 ~5.3MB
    if len(clean) > 7_000_000:
        raise RuntimeError("图片过大，请压缩到约 4MB 以内")

    payload = {"ImageBase64": clean}
    try:
        resp = _tc3_request("GeneralAccurateOCR", payload)
        resp["_engine"] = "GeneralAccurateOCR"
        return resp
    except OcrApiError as e:
        # 额度类错误直接抛出，让前端切本地 OCR
        if e.is_quota:
            raise
        # 未开通高精度等再试基础版
        try:
            resp = _tc3_request("GeneralBasicOCR", payload)
            resp["_engine"] = "GeneralBasicOCR"
            return resp
        except OcrApiError:
            raise e
    except RuntimeError as e:
        msg = str(e)
        if "FailedOperation" in msg or "UnauthorizedOperation" in msg or "Resource" in msg:
            resp = _tc3_request("GeneralBasicOCR", payload)
            resp["_engine"] = "GeneralBasicOCR"
            return resp
        raise


def _item_box(item: dict) -> tuple[float, float, float, float]:
    ip = item.get("ItemPolygon") or {}
    if ip and (ip.get("Width") or ip.get("Height")):
        return (
            float(ip.get("X") or 0),
            float(ip.get("Y") or 0),
            float(ip.get("Width") or 0),
            float(ip.get("Height") or 20),
        )
    poly = item.get("Polygon") or []
    if poly:
        xs = [float(p.get("X") or 0) for p in poly]
        ys = [float(p.get("Y") or 0) for p in poly]
        x0, y0 = min(xs), min(ys)
        return x0, y0, max(xs) - x0, max(ys) - y0
    return 0.0, 0.0, 0.0, 20.0


def _cluster_rows(detections: list[dict]) -> list[list[dict]]:
    items = []
    for d in detections:
        text = str(d.get("DetectedText") or "").strip()
        if not text:
            continue
        x, y, w, h = _item_box(d)
        items.append({"text": text, "x": x, "y": y, "w": w, "h": h or 20})
    if not items:
        return []
    items.sort(key=lambda t: (t["y"], t["x"]))
    heights = sorted(t["h"] for t in items if t["h"] > 0) or [20]
    median_h = heights[len(heights) // 2]
    tol = max(12.0, median_h * 0.65)

    rows: list[list[dict]] = []
    cur: list[dict] = []
    cur_y: Optional[float] = None
    for it in items:
        if cur_y is None or abs(it["y"] - cur_y) <= tol:
            cur.append(it)
            cur_y = it["y"] if cur_y is None else (cur_y * 0.6 + it["y"] * 0.4)
        else:
            rows.append(sorted(cur, key=lambda t: t["x"]))
            cur = [it]
            cur_y = it["y"]
    if cur:
        rows.append(sorted(cur, key=lambda t: t["x"]))
    return rows


def _parse_stat_number(num: str, unit: str = "") -> Optional[int]:
    try:
        v = float(str(num).replace(",", "").strip())
    except ValueError:
        return None
    u = (unit or "").strip()
    if u in ("万", "w", "W"):
        v *= 10000
    elif u == "亿":
        v *= 100_000_000
    return max(0, int(round(v)))


def _normalize_stat_text(s: str) -> str:
    """合并 OCR 碎片：3.6 万 → 3.6万；统一斜杠。"""
    t = str(s or "")
    t = t.replace("／", "/").replace("|", "/").replace("／", "/")
    t = re.sub(r"(\d+(?:\.\d+)?)\s*万", r"\1万", t)
    t = re.sub(r"(\d+(?:\.\d+)?)\s*亿", r"\1亿", t)
    t = re.sub(r"(\d+(?:\.\d+)?)\s*[wW]\b", r"\1万", t)
    return t


def _extract_stat_numbers(text: str) -> list[int]:
    t = _normalize_stat_text(text)
    out: list[int] = []
    for num, unit in STAT_NUM_RE.findall(t):
        # 避免把「万」单独匹配；unit 可为空
        v = _parse_stat_number(num, unit)
        if v is not None:
            out.append(v)
    return out


def _parse_int_token(tok: str) -> Optional[int]:
    return _parse_stat_number(tok.replace("%", ""), "")


def _extract_ints(texts: list[str]) -> list[int]:
    return _extract_stat_numbers(" ".join(texts))


def _is_header_row(joined: str, name: str) -> bool:
    if any(w in joined for w in ("击杀", "助攻", "死亡")) and sum(
        1 for w in HEADER_WORDS if w in joined
    ) >= 2:
        return True
    if name in HEADER_WORDS or SKIP_NAME_RE.match(name):
        return True
    return False


def _player_from_nums(name: str, nums: list[int]) -> Optional[dict]:
    """
    对照游戏结算行：
      昵称  击杀/死亡/助攻  玩家伤/承伤/治疗  对怪
    例：某某野兽 1/0/0 3.6万/2.7万/6506 8
    本系统字段顺序：击杀、助攻、死亡、玩家伤、承伤、治疗、对怪
    """
    name = (name or "").strip()[:40]
    if not name or SKIP_NAME_RE.match(name) or re.fullmatch(r"[\d,.\s/万亿]+", name):
        return None
    n = list(nums or [])
    if len(n) >= 7:
        # 游戏屏：K/D/A + 伤/承/治 + 对怪
        kills, deaths, assists = n[0], n[1], n[2]
        dmg_p, dmg_t, heal, dmg_m = n[3], n[4], n[5], n[6]
    elif len(n) == 6:
        kills, deaths, assists = n[0], n[1], n[2]
        dmg_p, dmg_t, heal, dmg_m = n[3], n[4], n[5], 0
    elif len(n) == 4:
        # 仅伤害四列
        kills = assists = deaths = 0
        dmg_p, dmg_t, heal, dmg_m = n[0], n[1], n[2], n[3]
    elif len(n) == 3:
        # 仅 伤/承/治
        kills = assists = deaths = 0
        dmg_p, dmg_t, heal, dmg_m = n[0], n[1], n[2], 0
    elif len(n) >= 1:
        # 兼容旧手填顺序：击杀 助攻 死亡 伤 承 治 对怪
        while len(n) < 7:
            n.append(0)
        kills, assists, deaths, dmg_p, dmg_t, heal, dmg_m = n[:7]
        # 若第 2、3 个数都很小且像 K/D/A（死亡位偏大），上面 >=7 已处理；
        # 短数组保持 assists/deaths 旧顺序
    else:
        kills = assists = deaths = dmg_p = dmg_t = heal = dmg_m = 0

    return {
        "name": name,
        "kills": int(kills),
        "assists": int(assists),
        "deaths": int(deaths),
        "dmgPlayer": int(dmg_p),
        "dmgTaken": int(dmg_t),
        "healing": int(heal),
        "dmgMonster": int(dmg_m),
    }


def _row_to_player(tokens: list[str]) -> Optional[dict]:
    if not tokens:
        return None
    # 先拼行，再拆名字与数字（适配 1/0/0、3.6万/2.7万）
    joined_raw = " ".join(tokens)
    joined = _normalize_stat_text(joined_raw)
    if _is_header_row(joined, ""):
        # 进一步用首段当 name 再判一次
        pass

    m = re.match(r"^([^\d]+?)(?=\d)", joined)
    if m:
        name = re.sub(r"\s+", "", m.group(1)).strip(" ·|:|\\-—_")
        rest = joined[m.end() :]
    else:
        # 回退：非数字 token 当名字
        name_parts: list[str] = []
        rest_parts: list[str] = []
        seen_num = False
        for t in tokens:
            nt = _normalize_stat_text(t)
            if STAT_NUM_RE.search(nt) and (
                NUM_TOKEN_RE.match(nt.replace("万", "").replace("亿", "").replace("/", ""))
                or "/" in nt
                or "万" in nt
            ):
                seen_num = True
                rest_parts.append(nt)
            elif not seen_num:
                name_parts.append(t)
            else:
                rest_parts.append(nt)
        name = re.sub(r"\s+", "", "".join(name_parts)).strip(" ·|:|\\-—_")
        rest = " ".join(rest_parts) if rest_parts else joined

    if _is_header_row(joined, name or ""):
        return None
    nums = _extract_stat_numbers(rest)
    # 名字里若误吞数字，上面 regex 已尽量避免
    return _player_from_nums(name, nums)


def parse_scoreboard_detections(detections: list[dict]) -> tuple[list[dict], list[str]]:
    rows = _cluster_rows(detections)
    players: list[dict] = []
    raw_lines: list[str] = []
    for row in rows:
        texts = [t["text"] for t in row]
        line = " ".join(texts)
        raw_lines.append(line)
        p = _row_to_player(texts)
        if p:
            players.append(p)
    # 去重：同名保留战绩更「满」的一条
    best: dict[str, dict] = {}
    for p in players:
        key = p["name"]
        prev = best.get(key)
        score = (
            p["kills"]
            + p["assists"]
            + p["deaths"]
            + p["dmgPlayer"]
            + p["dmgTaken"]
            + p["healing"]
            + p["dmgMonster"]
        )
        if not prev or score >= (
            prev["kills"]
            + prev["assists"]
            + prev["deaths"]
            + prev["dmgPlayer"]
            + prev["dmgTaken"]
            + prev["healing"]
            + prev["dmgMonster"]
        ):
            best[key] = p
    return list(best.values()), raw_lines


def parse_scoreboard_text(text: str) -> tuple[list[dict], list[str]]:
    """纯文本粘贴兜底：每行 昵称 + 数字。"""
    players: list[dict] = []
    raw_lines: list[str] = []
    for line in (text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        raw_lines.append(line)
        parts = re.split(r"[\s\t|,;/]+", line)
        parts = [p for p in parts if p]
        p = _row_to_player(parts)
        if p:
            players.append(p)
    return players, raw_lines


def recognize_and_parse(image_b64: str) -> dict[str, Any]:
    resp = recognize_image_base64(image_b64)
    detections = resp.get("TextDetections") or []
    players, raw_lines = parse_scoreboard_detections(detections)
    return {
        "engine": resp.get("_engine") or "GeneralAccurateOCR",
        "players": players,
        "rawLines": raw_lines[:80],
        "detectionCount": len(detections),
    }
