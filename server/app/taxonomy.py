from __future__ import annotations

import re


SUBCATEGORY_ALIASES = {
    "智能手机": "手机",
    "移动电话": "手机",
    "手机通讯": "手机",
    "蓝牙耳机": "耳机",
    "无线耳机": "耳机",
    "头戴耳机": "耳机",
    "平板电脑": "平板",
    "笔记本电脑": "电脑",
    "台式电脑": "电脑",
    "个人电脑": "电脑",
    "数码相机": "相机",
    "微单相机": "相机",
    "单反相机": "相机",
    "智能手表": "手表",
    "游戏主机": "游戏机",
}


def canonical_subcategory(value: str) -> str:
    normalized = re.sub(r"[\W_]+", "", value, flags=re.UNICODE).lower()
    return SUBCATEGORY_ALIASES.get(normalized, normalized)
