# -*- coding: utf-8 -*-
"""腾讯云 COS 预签名（纯标准库，无第三方依赖）"""

from __future__ import annotations

import hashlib
import hmac
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def cos_configured() -> bool:
    return bool(
        _env("COS_SECRET_ID")
        and _env("COS_SECRET_KEY")
        and _env("COS_BUCKET")
        and _env("COS_REGION")
    )


def cos_public_base() -> str:
    base = _env("COS_PUBLIC_BASE_URL").rstrip("/")
    if base:
        return base
    bucket = _env("COS_BUCKET")
    region = _normalize_region(_env("COS_REGION"))
    return f"https://{bucket}.cos.{region}.myqcloud.com"


def _normalize_region(region: str) -> str:
    # 兼容误写 aap-shanghai
    if region.startswith("aap-"):
        return "ap-" + region[4:]
    return region


def _hmac_sha1(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha1).digest()


def _sha1_hex(msg: str) -> str:
    return hashlib.sha1(msg.encode("utf-8")).hexdigest()


def _encode_key(key: str) -> str:
    # 路径分段编码，保留 /
    return "/".join(urllib.parse.quote(p, safe="") for p in key.split("/"))


def build_authorization(
    method: str,
    key: str,
    headers: Optional[dict] = None,
    params: Optional[dict] = None,
    expire: int = 600,
) -> str:
    secret_id = _env("COS_SECRET_ID")
    secret_key = _env("COS_SECRET_KEY")
    headers = {k.lower(): str(v).strip() for k, v in (headers or {}).items()}
    params = {str(k).lower(): str(v) for k, v in (params or {}).items()}

    start = int(time.time()) - 60
    end = start + max(60, expire) + 60
    key_time = f"{start};{end}"
    sign_key = _hmac_sha1(secret_key.encode("utf-8"), key_time).hex()

    header_list = sorted(headers.keys())
    param_list = sorted(params.keys())
    http_headers = "&".join(
        f"{urllib.parse.quote(k, safe='')}={urllib.parse.quote(headers[k], safe='')}"
        for k in header_list
    )
    http_params = "&".join(
        f"{urllib.parse.quote(k, safe='')}={urllib.parse.quote(params[k], safe='')}"
        for k in param_list
    )
    pathname = "/" + key.lstrip("/")
    http_string = (
        f"{method.lower()}\n{pathname}\n{http_params}\n{http_headers}\n"
    )
    string_to_sign = f"sha1\n{key_time}\n{_sha1_hex(http_string)}\n"
    signature = _hmac_sha1(sign_key.encode("utf-8"), string_to_sign).hex()

    return (
        "q-sign-algorithm=sha1"
        f"&q-ak={secret_id}"
        f"&q-sign-time={key_time}"
        f"&q-key-time={key_time}"
        f"&q-header-list={';'.join(header_list)}"
        f"&q-url-param-list={';'.join(param_list)}"
        f"&q-signature={signature}"
    )


def presigned_put_url(key: str, content_type: str, expire: int = 900) -> str:
    """浏览器直传：PUT 到该 URL，需带相同 Content-Type。"""
    region = _normalize_region(_env("COS_REGION"))
    bucket = _env("COS_BUCKET")
    host = f"{bucket}.cos.{region}.myqcloud.com"
    headers = {"host": host, "content-type": content_type}
    auth = build_authorization("PUT", key, headers=headers, expire=expire)
    # 预签名：把签名放 query；Content-Type 仍由客户端请求头携带
    # 使用 header 签名时，预签名 URL 常用 q-header-list 含 content-type、host
    # 客户端 PUT 必须带 Content-Type
    encoded = _encode_key(key.lstrip("/"))
    return f"https://{host}/{encoded}?{auth}"


def public_url_for_key(key: str) -> str:
    return f"{cos_public_base()}/{_encode_key(key.lstrip('/'))}"


def delete_object(key: str) -> None:
    if not cos_configured() or not key:
        return
    region = _normalize_region(_env("COS_REGION"))
    bucket = _env("COS_BUCKET")
    host = f"{bucket}.cos.{region}.myqcloud.com"
    path_key = key.lstrip("/")
    headers = {"host": host}
    auth = build_authorization("DELETE", path_key, headers=headers, expire=600)
    url = f"https://{host}/{_encode_key(path_key)}"
    req = urllib.request.Request(url, method="DELETE")
    req.add_header("Host", host)
    req.add_header("Authorization", auth)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        # 404 视为已删除
        if e.code != 404:
            raise
