# 📓 나만의 메모장 (Notepad)

에버노트 스타일의 개인 메모장입니다. 노트북·태그·검색·휴지통·리치텍스트 편집을 지원하며,
데이터는 [Turso(libSQL)](https://turso.tech) 에 저장됩니다. 배포는 **Render Blueprint(무료 플랜)** 로 합니다.

## 기능

- 📔 **노트북**: 노트를 폴더처럼 묶어서 관리 (사이드바 `+` 로 추가, 우클릭으로 이름변경/삭제)
- 🏷️ **태그**: 노트마다 태그를 달고 태그별로 모아보기
- 🔎 **검색**: 제목·본문 전체 검색
- ✍️ **리치텍스트 편집기**: 굵게/기울임/밑줄/취소선/목록/제목/인용
- 📌 **고정(pin)**:ㅁ 중요한 노트를 목록3333 상단에 고정
- 🗑️ **휴지통**: 삭제한 노트를 보관하고 복원 또는 완전 삭제
- 💾 **자동 저장**: 입력하면 자동으로 저장 (디바운스 0.6초)

## 기술 스택

| 영역      | 사용 기술                          |
| --------- | ---------------------------------- |
| 백엔드    | Node.js + Express (ESM)            |
| 데이터베이스 | Turso / libSQL (`@libsql/client`) |
| 프론트엔드 | 바닐라 HTML/CSS/JS (3분할 레이아웃) |
| 배포      | Render Blueprint (`render.yaml`, 무료 플랜) |

## 로컬 실행

`.env` 파일에 Turso 접속 정보가 있어야 합니다:

```
TURSO_URL=libsql://<your-db>.turso.io
TURSO_TOKEN=<your-token>
```

설치 및 실행:

```bash
npm install
node --env-file=.env server.js
# http://localhost:3000
```

> **사내망(KONAI) 참고**: 회사 프록시(KONA-PROXY)가 TLS를 가로채는 환경에서는
> 루트 CA 인증서를 `NODE_EXTRA_CA_CERTS` 로 지정해야 Turso 연결이 됩니다.
> 예: `NODE_EXTRA_CA_CERTS=./kona-proxy-ca.pem node --env-file=.env server.js`
> (이 인증서 파일은 로컬 전용이며 `.gitignore` 로 커밋에서 제외됩니다. Render 클라우드에서는 불필요합니다.)

## 배포 (Render Blueprint · 무료 플랜)

1. 이 저장소를 GitHub 에 올립니다. (`.env` 는 `.gitignore` 로 제외되어 커밋되지 않습니다)
2. [Render Dashboard](https://dashboard.render.com) → **New +** → **Blueprint** 선택
3. 저장소를 연결하면 `render.yaml` 을 자동 인식합니다. (`plan: free` 로 고정되어 있음)
4. **환경 변수**에 `TURSO_URL` 과 `TURSO_TOKEN` 을 입력합니다. (`sync: false` 이므로 대시보드에서 직접 입력)
5. **Apply** → 빌드/배포 완료 후 발급된 URL 로 접속합니다.

> ⚠️ Render 무료 플랜 웹 서비스는 15분간 요청이 없으면 잠자기(sleep) 상태가 되어,
> 다음 첫 요청 시 깨어나는 데 수십 초가 걸릴 수 있습니다. (무료 플랜의 정상 동작)

## REST API

| 메서드 | 경로                  | 설명                                            |
| ------ | --------------------- | ----------------------------------------------- |
| GET    | `/api/notebooks`      | 노트북 목록 (노트 개수 포함)                    |
| POST   | `/api/notebooks`      | 노트북 생성                                     |
| PUT    | `/api/notebooks/:id`  | 노트북 이름 변경                                |
| DELETE | `/api/notebooks/:id`  | 노트북 삭제 (노트는 유지)                       |
| GET    | `/api/tags`           | 사용 중인 태그 목록                             |
| GET    | `/api/notes`          | 노트 목록 (`?notebook= ?tag= ?q= ?trashed=1`)   |
| GET    | `/api/notes/:id`      | 노트 단건 조회                                  |
| POST   | `/api/notes`          | 노트 생성                                       |
| PUT    | `/api/notes/:id`      | 노트 수정 (title/content/notebook_id/tags/pin/trash) |
| DELETE | `/api/notes/:id`      | 노트 완전 삭제                                  |
