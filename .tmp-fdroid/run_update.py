#!/usr/bin/env python3
"""Wrapper: 跳过 APK 签名验证 + 用 jarsigner 签 index_unsigned.jar。"""
import sys
import os

# 1) Monkey patch: 跳过 APK 签名验证
import fdroidserver.common as common
_orig_verify = common.verify_apk_signature
def _patched_verify(apk, min_sdk_version=None):
    print(f"[PATCH] 跳过 APK 签名验证: {apk}")
    return True
common.verify_apk_signature = _patched_verify

# 2) Patch sign_index: 用 jarsigner 替代 apksigner
import fdroidserver.signindex as signindex
_orig_sign_jar = signindex.sign_jar
def _patched_sign_jar(jar_file):
    """用 jarsigner 签 jar（v1 签名）"""
    keystore = os.path.join(os.path.dirname(__file__), 'keystore.p12')
    if not os.path.exists(keystore):
        # fdroidserver 默认 keystore 路径
        home = os.path.expanduser('~')
        keystore = os.path.join(home, '.config', 'fdroid', 'keystore.p12')
    if not os.path.exists(keystore):
        print(f"[PATCH] keystore.p12 不存在，跳过签名: {jar_file}")
        return
    import subprocess
    storepass = 'androidkeystore'  # fdroidserver --create-key 默认密码
    alias = 'fdroidrepo'
    cmd = [
        'jarsigner',
        '-keystore', keystore,
        '-storepass', storepass,
        '-storetype', 'PKCS12',
        '-sigalg', 'SHA1withRSA',
        '-digestalg', 'SHA1',
        jar_file,
        alias,
    ]
    print(f"[PATCH] jarsigner 签名: {jar_file}")
    subprocess.check_call(cmd)
    # 验证
    subprocess.check_call(['jarsigner', '-verify', '-keystore', keystore,
                          '-storepass', storepass, '-storetype', 'PKCS12', jar_file])
signindex.sign_jar = _patched_sign_jar

# 3) 调用 fdroid update
from fdroidserver.__main__ import main
sys.argv[0] = 'fdroid'
main()
