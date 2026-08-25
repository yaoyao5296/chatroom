#!/usr/bin/env python3
"""Wrapper: 跳过 APK 签名验证 + 强制用 jarsigner 签 index jar。
用法: python run_update.py update --create-key --pretty --clean
"""
import sys
import os

# 1) Monkey patch: 跳过 APK 签名验证
import fdroidserver.common as common


def _patched_verify(apk, min_sdk_version=None):
    print(f"[PATCH] 跳过 APK 签名验证: {apk}")
    return True


common.verify_apk_signature = _patched_verify

# 2) Patch sign_jar: 强制走 jarsigner 老算法分支，即使 use_old_algs=False
import fdroidserver.signindex as signindex
_orig_sign_jar = signindex.sign_jar


def _patched_sign_jar(jar_file, use_old_algs=False):
    """强制用 jarsigner 签 jar（绕过 apksigner）"""
    # 总是走 use_old_algs=True 分支
    return _orig_sign_jar(jar_file, use_old_algs=True)


signindex.sign_jar = _patched_sign_jar

# 3) Patch: 让 sign_index 里对 index.xml/index-v1.json 的调用也走老算法
# sign_index 内部对 index.xml/index-v1.json 已传 use_old_algs=True，无需改
# 但 entry.json 走 use_old_algs=False → 已被上面 patch 拦截

# 4) 调用 fdroid update
from fdroidserver.__main__ import main
sys.argv[0] = 'fdroid'
main()
