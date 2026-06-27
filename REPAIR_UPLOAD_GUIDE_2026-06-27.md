# GitHub 구조 수리 업로드 안내 - 2026-06-27

앱 파일과 연구 결과는 올라갔지만, 자동 예보/정산 실행에 필요한 두 폴더가 GitHub에서 올바른 위치에 있어야 합니다.

## 현재 필요한 수리

필수 위치:

- `.github/workflows/daily-market-forecast.yml`
- `scripts/shadow/run.py`
- `scripts/shadow/snapshot.ts`
- `scripts/modeling/requirements.txt`

현재 GitHub에는 `shadow`, `panel`, `modeling` 같은 폴더가 루트에 풀려 올라간 상태라서, 자동화가 찾는 `scripts/...` 경로가 없습니다.

## 업로드 방법

`market-weathercast-repair-upload-2026-06-27` 폴더 안에 있는 아래 항목을 GitHub 업로드 화면에 올리세요.

- `.github`
- `scripts`
- `.gitignore`
- `REPAIR_UPLOAD_GUIDE_2026-06-27.md`

이번에는 `scripts` 폴더 안으로 들어가지 말고, `scripts` 폴더 자체를 드래그하세요.

커밋 메시지 예시:

`fix: restore workflow and scripts folders`

## .github 폴더 업로드가 어려울 때

GitHub 웹에서 `.github` 폴더가 잘 안 올라가면 직접 파일을 만들면 됩니다.

1. GitHub에서 `Add file` → `Create new file`
2. 파일 이름에 아래 경로 입력

`.github/workflows/daily-market-forecast.yml`

3. 로컬의 `.github/workflows/daily-market-forecast.yml` 내용을 복사해서 붙여넣기
4. Commit changes

## 수리 후 확인

GitHub 저장소 상단에 `Actions` 탭을 누르면 `Daily market weather forecast` 워크플로우가 보여야 합니다.

이 워크플로우가 보여야 공식 V2 관측 기록이 자동으로 쌓이기 시작합니다.

