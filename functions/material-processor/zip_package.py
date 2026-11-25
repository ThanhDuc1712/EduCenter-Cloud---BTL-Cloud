"""Nén thư mục build thành zip cho Function Compute với đường dẫn dùng dấu '/'.

Compress-Archive của Windows PowerShell 5.1 ghi đường dẫn bằng dấu '\\', Linux hiểu thành tên file
có ký tự '\\' và FC không import được thư viện. Script này thay thế Compress-Archive.
Dùng: python zip_package.py <thu_muc_build> <file_zip>
"""
import os
import sys
import zipfile


def main(src: str, dst: str) -> None:
    count = 0
    with zipfile.ZipFile(dst, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(src):
            dirs[:] = [d for d in dirs if d != "__pycache__"]
            for name in files:
                if name.endswith(".pyc"):
                    continue
                full = os.path.join(root, name)
                arc = os.path.relpath(full, src).replace(os.sep, "/")
                zf.write(full, arc)
                count += 1
    names = zipfile.ZipFile(dst).namelist()
    if "index.py" not in names or any("\\" in n for n in names):
        raise SystemExit("ZIP SAI: thieu index.py o goc hoac co dau '\\' trong duong dan")
    print(f"OK: {count} file, index.py o goc zip")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
