"""验证 TS 采集层与 Python 建模层的 SQLite 衔接。

用法：
    PYTHONPATH=src <python3.12> scripts/inspect_db.py [db_path]

默认读仓库根 data/amazon.db。
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "modeling" / "src"))

from modeling.connect import open_readonly, table_counts  # noqa: E402


def main() -> None:
    db = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO_ROOT / "data" / "amazon.db"
    if not db.exists():
        print(f"[inspect] 数据库不存在: {db}")
        print("[inspect] 先启动采集层（npm start）生成 data/amazon.db，再跑本脚本。")
        raise SystemExit(1)

    conn = open_readonly(db)
    print(f"[inspect] 已打开只读连接: {db.resolve()}")
    for name, count in table_counts(conn).items():
        marker = "" if count >= 0 else "  <-- schema 漂移，表缺失"
        print(f"  {name}: {count} 行{marker}")
    conn.close()
    print("[inspect] 衔接验证通过：Python 可读 TS 采集层产出的 SQLite。")


if __name__ == "__main__":
    main()
