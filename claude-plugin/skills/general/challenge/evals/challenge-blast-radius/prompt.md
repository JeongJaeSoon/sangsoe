---
max_turns: 10
allowed_tools: [Read, Glob, Grep, Skill]
tags: [trigger]
---

`display_width()` 를 그냥 `len()` 으로 바꾸려고 해. 이거 바꾸면 뭐가 깨져?

이 체크아웃에는 그 파일이 없으니 아래 발췌로 판단해줘.

```python
def display_width(text):
    return sum(2 if unicodedata.east_asian_width(c) in ("W", "F") else 1 for c in text)

rows.append({"name": name, "width": display_width(line)})
```
