# 제트카 슬랙 캘린더 — 설치 가이드

제트카 업무 캘린더 시트를 슬랙 **앱 홈 탭**에 렌더링합니다.
일간·주간·월간 전환, 업무 구분 필터, 슬랙 안에서 일정 추가(시트에 바로 기록)까지 동작합니다.

처음이라면 **1.5~2시간** 정도 걸립니다.

---

## 시트 구조 (읽기 전용으로 파악한 내용)

기존 시트를 그대로 씁니다. **새로 만들 것도, 컬럼을 바꿀 것도 없습니다.**

| 탭 | 헤더 | 용도 |
| --- | --- | --- |
| 일정 | `id` `date` `type` `vehicleNumber` `customerName` `memo` `completionDate` `isReady` `agencyContract` | 홈 화면 본문 |
| 휴가 | `id` `date` `employeeName` `memo` `status` `vacationType` | 상단 휴가 한 줄 |
| 월렌트 대장 | `id` `checkoutId` `date` `type` … `amount` `status` | **읽지 않음** (별도 관리 대장으로 판단) |

**탭 이름은 하드코딩하지 않았습니다.** 스프레드시트의 모든 탭에서 1행 헤더를 읽어 자동 판별합니다.

- `employeeName` + `vacationType` 이 있으면 → 휴가 탭
- `type` + `vehicleNumber` 가 있고 `checkoutId` 는 **없으면** → 일정 탭
- `checkoutId` 가 있으면 월렌트 대장으로 보고 건너뜀

컬럼 순서가 바뀌거나 중간에 컬럼이 추가돼도 깨지지 않습니다. 자동 판별이 틀리면 `.env` 에서 `SHEET_TAB_SCHEDULE` 로 직접 지정하면 됩니다.

시트에 동일 데이터가 두 탭에 중복 존재하는 것으로 보이는데, `id` 기준으로 한 번 걸러내므로 화면에 두 번 뜨지 않습니다.

### `type` 값 매핑

| 시트 값 | 화면 표기 |
| --- | --- |
| `long-term-out` | 🚗 장기 출고 |
| `long-term-return` | 📥 장기 반납 |
| `monthly-rental-out` | 📅 월렌트 출고 |
| `monthly-rental-return` | 📥 월렌트 반납 |
| `affiliate-out` | 🤝 제휴 출고 |

새 `type` 이 시트에 생기면 원본 값 그대로 표시됩니다(에러 안 남). 아이콘·라벨을 붙이려면 `lib/views.ts` 의 `TYPES` 에 한 줄 추가하세요.

### 날짜 처리

`2026. 2. 28 오후 1:30:00` / `2026. 1. 14` / `2025-12-31` — 시트에 섞여 있는 세 형식을 모두 인식합니다.

- **`오전 9:00:00` 은 시간을 표시하지 않습니다.** 출고 건 대부분이 9시로 찍혀 있어 실제 약속 시간이 아니라 기본값으로 판단했습니다. 이게 실제 시간이라면 `lib/views.ts` 의 `renderRow` 에서 `e.time !== '09:00'` 조건을 지우세요.
- `completionDate` 가 채워진 건은 ✅ 가 붙습니다.

---

## 1단계 · 구글 서비스 계정 발급 (15분)

Apps Script가 아니라 **서비스 계정**을 쓰는 이유는, 슬랙 인터랙션의 3초 응답 제한을 Apps Script가 리다이렉트·콜드스타트 때문에 자주 넘기기 때문입니다.

1. [console.cloud.google.com](https://console.cloud.google.com) 접속
2. 상단 프로젝트 선택 → **새 프로젝트** → 이름 `jetcar-slack` → 만들기
3. **API 및 서비스 → 라이브러리** → `Google Sheets API` 검색 → **사용 설정**
4. **API 및 서비스 → 사용자 인증 정보** → **사용자 인증 정보 만들기 → 서비스 계정**
   - 이름 `jetcar-slack-calendar`, 역할은 비워두고 **완료**
5. 생성된 계정 클릭 → **키** 탭 → **키 추가 → 새 키 만들기 → JSON** → 다운로드

JSON 안에서 `client_email` 과 `private_key` 두 값을 씁니다.

### 1-1. 시트에 서비스 계정 공유 ⚠️ 빠뜨리기 쉬움

업무 캘린더 시트에서 **공유** → `client_email` 주소를 **편집자**로 추가합니다.
일정 추가 기능을 쓰려면 뷰어로는 안 됩니다. "알림 전송" 체크는 해제해도 됩니다.

---

## 2단계 · 슬랙 앱 생성 (20분)

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
   - App Name `제트카 캘린더`, 워크스페이스 선택 → **Create App**
2. **OAuth & Permissions** → *Bot Token Scopes* 에 **`chat:write`** 추가
   > 홈 탭 자체에는 별도 스코프가 필요 없습니다. `app_home:write` 같은 스코프를 찾다가 시간 버리는 경우가 많은데, 그런 스코프는 존재하지 않습니다.
3. **App Home** → *Show Tabs* → **Home Tab 토글 ON** (Messages Tab은 꺼도 됨)
4. **Install App** → **Install to Workspace** → **Allow**
   - **Bot User OAuth Token** (`xoxb-`로 시작) 복사
5. **Basic Information** → **Signing Secret** 복사

**여기서 멈춥니다.** URL 설정은 Vercel 배포 후에 합니다 (슬랙이 입력 즉시 URL을 검증하기 때문).

---

## 3단계 · Vercel 배포 (20분)

```bash
cd jetcar-slack-calendar
npm install

git init
git add .
git commit -m "init: jetcar slack calendar"
git remote add origin https://github.com/<계정>/jetcar-slack-calendar.git
git push -u origin main
```

[vercel.com/new](https://vercel.com/new) → 저장소 **Import** → Framework가 **Next.js** 로 인식되는지 확인 → **Environment Variables** 5개 등록 (Production / Preview / Development 모두 체크).

| Key | Value |
| --- | --- |
| `SLACK_BOT_TOKEN` | `xoxb-...` |
| `SLACK_SIGNING_SECRET` | Basic Information 에서 복사 |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | JSON의 `client_email` |
| `GOOGLE_PRIVATE_KEY` | JSON의 `private_key` **전체** |
| `SHEET_ID` | `1M5Vms-aqHtV3cVS0VGxGeEkloDNCC4Nznaio11FoKrI` |

> **`GOOGLE_PRIVATE_KEY` 주의**
> JSON에 있는 `\n` 을 실제 줄바꿈으로 바꾸지 말고 **문자 그대로** 붙여넣으세요.
> 코드에서 `.replace(/\\n/g, '\n')` 로 되돌립니다. 틀리면 `DECODER routines::unsupported` 가 납니다.

**Deploy** → 도메인 확인 (예: `https://jetcar-slack-calendar.vercel.app`)

---

## 4단계 · 슬랙에 URL 연결 (10분)

슬랙 앱 설정으로 돌아갑니다.

**Event Subscriptions**
1. **Enable Events** ON
2. Request URL: `https://<도메인>/api/slack/events` → **Verified ✓** 확인
3. *Subscribe to bot events* → **Add Bot User Event** → **`app_home_opened`**
4. **Save Changes**

**Interactivity & Shortcuts**
1. **Interactivity** ON
2. Request URL: `https://<도메인>/api/slack/interactions`
   ⚠️ `/events` 가 아니라 **`/interactions`** 입니다. 가장 흔한 실수입니다.
3. **Save Changes**

마지막으로 **Install App → Reinstall to Workspace** 를 한 번 눌러줍니다.

---

## 5단계 · 확인

슬랙 좌측 사이드바 **앱** → **제트카 캘린더** → **홈** 탭.

```
📅 01/19 ~ 01/25
[◀] [오늘] [▶] [주간 ▾] [전체 구분 ▾]
🌴 휴가 01/22 임지혜(연차)  |  01/23 유창규(연차), 민경란(연차)
──────────────────────────────────────
01/22 (목) · 12건
🚗 장기 출고 · 그랜저 104허6543 · 지혜 통영 창규 / 구태회 / 36개월
📥 장기 반납 · GV80 116호6072 · 연체 중 탁송 회수 예정 ✅
　　↳ 탁송 회수 완료 26.01.22 21:47 29,152km
📅 월렌트 출고 · 베뉴 116호6719 · 청주 오전10시반

01/23 (금) · 9건
📥 `17:00` 장기 반납 · 쏘나타 116호6100 · 여기민 ✅
　　↳ 임차인 직접 반납 완료
──────────────────────────────────────
[＋ 일정 추가] [🔄 새로고침]
총 21건 · 8. 14. 10:08 기준
```

주간이 기본값입니다. 드롭다운으로 일간·월간 전환, ◀▶ 로 이동합니다.
**＋ 일정 추가** 로 등록한 내용이 시트에 실제로 쌓이는지 확인하세요.

---

## 문제 해결

| 증상 | 조치 |
| --- | --- |
| Request URL 이 응답 없음 | 배포 완료 전에 눌렀거나 경로 오타. Vercel Deployments 에서 Ready 확인 후 재시도 |
| 홈 탭이 계속 비어 있음 | `app_home_opened` 이벤트 구독 여부, App Home 의 Home Tab 토글 확인 |
| "캘린더를 불러오지 못했습니다" | Vercel → Logs 확인. 대부분 시트 공유 누락 또는 `GOOGLE_PRIVATE_KEY` 개행 문제 |
| "일정 탭을 찾지 못했습니다" | 로그에 탭 목록이 찍힙니다. `.env` 에 `SHEET_TAB_SCHEDULE=<탭이름>` 직접 지정 |
| 월렌트 대장 데이터가 섞여 나옴 | `SHEET_TAB_SCHEDULE` 로 일정 탭을 명시 지정 |
| `invalid signature` 401 | `SLACK_SIGNING_SECRET` 오타. Basic Information 에서 재복사 |
| `DECODER routines::unsupported` | `GOOGLE_PRIVATE_KEY` 를 실제 줄바꿈으로 넣었을 때. `\n` 리터럴로 저장 후 **재배포** |
| 버튼은 눌리는데 화면이 안 바뀜 | Interactivity URL 이 `/api/slack/interactions` 인지 확인 |
| 환경변수 고쳤는데 그대로임 | Vercel 환경변수는 **재배포해야** 반영됨. Deployments → Redeploy |
| 일정이 목록에 없음 | `date` 셀이 비었거나 인식 불가 형식. 연·월·일이 구분자로 나뉘어 있어야 함 |

로그는 **Vercel → 프로젝트 → Logs**. `[slack]`, `[app_home_opened]`, `[republish]` 접두어로 필터하면 빠릅니다.

---

## 알아둘 제약

- **격자형 달력(7×5 표)은 못 만듭니다.** Block Kit에 그리드 레이아웃이 없어 세로 목록형이 최선입니다. 격자가 꼭 필요하면 그 부분만 이미지로 렌더링해 상단에 이미지 블록으로 끼워넣는 하이브리드가 가능합니다.
- **블록 100개 상한.** "하루 = 블록 1개"로 묶어 렌더링합니다. 하루 15건 × 31일(월간 465건)로 테스트했을 때 37블록, 가장 긴 블록 1,097자로 여유가 충분합니다.
- **`views.publish` 는 분당 약 50회 제한.** 개인 단위 화면이라 실사용에서 걸릴 일은 거의 없습니다.
- **홈 탭은 클라이언트에 캐시됩니다.** 열어두고 방치하면 오래된 화면이 남아서, 하단에 갱신 시각을 표시하고 새로고침 버튼을 뒀습니다.
- **읽기 시 매번 시트 전체를 조회합니다.** 현재 400여 행이라 문제없지만, 수천 행이 되면 Vercel KV 등에 30초 캐시를 두는 게 좋습니다.

---

## 다음에 붙일 만한 것

우선순위 순:

1. **아침 브리핑 웹훅** — 매일 8시 채널에 오늘 출고·반납 요약. `lib/slack.ts` 의 `postMessage` + Vercel Cron 으로 반나절.
2. **일정 완료 처리** — 각 날짜 섹션에 overflow 메뉴를 달고 `completionDate` 를 `values.update` 로 기록. 지금 `id` 를 이미 읽고 있어 행 찾기가 쉽습니다.
3. **차량번호 검색** — 슬래시 커맨드 `/차량 116호7147` 로 해당 차량의 출고·반납 이력 조회.
4. **휴가 신청 모달** — 휴가 탭에 쓰기. 구조가 일정 추가와 동일해서 복사 수준.
