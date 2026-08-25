#!/usr/bin/env python3
"""重新打包并签名 jar（jarsigner 老算法）。"""
import os
import json
import zipfile
import subprocess

REPO = 'repo'
KS = 'keystore.p12'
ALIAS = 'all-in-one-63-wfbdd'
STOREPASS = 'OoQ86/aJ7NdnAbe4bboovuJ0rK07RkcHXoqc+kPf6oE='


def repackage(json_name):
    """把 json 重新打成 jar（覆盖原 jar）"""
    jar_name = json_name.replace('.json', '.jar')
    jar_path = os.path.join(REPO, jar_name)
    json_path = os.path.join(REPO, json_name)
    with zipfile.ZipFile(jar_path, 'w', zipfile.ZIP_DEFLATED) as jar:
        jar.write(json_path, json_name)
    print(f"重新打包: {jar_path}")
    return jar_path


def sign_jar(jar_path):
    """jarsigner 签名"""
    cmd = [
        'jarsigner',
        '-keystore', KS,
        '-storepass', STOREPASS,
        '-storetype', 'PKCS12',
        '-sigalg', 'SHA1withRSA',
        '-digestalg', 'SHA1',
        jar_path,
        ALIAS,
    ]
    subprocess.check_call(cmd)
    # 验证
    subprocess.check_call(['jarsigner', '-verify', '-keystore', KS,
                          '-storepass', STOREPASS, '-storetype', 'PKCS12', jar_path])
    print(f"签名验证通过: {jar_path}")


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    # entry.json 需要先更新其内部 index 的 sha256（来自 index-v2.json）
    with open(os.path.join(REPO, 'index-v2.json')) as f:
        index_v2 = json.load(f)
    # 计算 index-v2.json sha256
    import hashlib
    with open(os.path.join(REPO, 'index-v2.json'), 'rb') as f:
        v2_sha = hashlib.sha256(f.read()).hexdigest()
    v2_size = os.path.getsize(os.path.join(REPO, 'index-v2.json'))
    # 更新 entry.json
    entry_path = os.path.join(REPO, 'entry.json')
    with open(entry_path) as f:
        entry = json.load(f)
    entry['index']['sha256'] = v2_sha
    entry['index']['size'] = v2_size
    with open(entry_path, 'w') as f:
        json.dump(entry, f, indent=2)
    print(f"更新 entry.json: sha256={v2_sha}, size={v2_size}")

    # 重新打包并签名
    for j in ['index-v1.json', 'index-v2.json', 'entry.json']:
        jar = repackage(j)
        sign_jar(jar)

    # index.xml → index.jar（旧 v1 格式）
    # index.jar 内含 index.xml
    xml_path = os.path.join(REPO, 'index.xml')
    jar_path = os.path.join(REPO, 'index.jar')
    with zipfile.ZipFile(jar_path, 'w', zipfile.ZIP_DEFLATED) as jar:
        jar.write(xml_path, 'index.xml')
    print(f"重新打包: {jar_path}")
    sign_jar(jar_path)

    print("全部完成！")


if __name__ == '__main__':
    main()
