# 일정과 기념일 알림

현재 출시 보류 상태다. 운영 Cron의 `event-reminders` 작업은 비활성화되어 있고, Edge Function도 `EVENT_REMINDERS_ENABLED=true`를 명시해야 작동한다. 아래는 기능을 다시 출시할 때 참고하는 절차다.

중요하거나 꼭 챙길 일정과 기념일마다 알림을 켜고, 받을 사람과 시점을 고를 수 있다. 받는 사람은 가계부의 설정 → 일정 알림에서 자기 기기를 등록한다. iPhone·iPad는 iOS·iPadOS 16.4 이상에서 홈 화면에 추가한 가계부를 열어 등록한다. 데스크톱은 웹 푸시를 지원하는 브라우저에서 등록한다. 기기마다 알림을 허용해야 한다.

알림은 한국 시간 기준으로 보낸다. 시간 없는 일정과 기념일은 오전 9시를 기준으로 계산하고, 여러 날 일정은 시작일에 한 번 보낸다. 반복 일정은 회차마다 같은 규칙을 적용하고 건너뛴 날짜는 뺀다. 알림을 누르면 해당 날짜의 달력이 열린다. 잠금 화면의 알림에는 일정 이름과 메모를 싣지 않는다.

## 서버 설정

1. 공유 DB에는 저장소의 승인 절차에 따라 `20261120000000_event_reminders.sql`까지 적용한다. 호스팅 Supabase의 Vault, Cron(`pg_cron`), `pg_net`을 사용한다. Cron 화면에서 `event-reminders` 작업이 1분마다 실행되도록 등록됐는지 확인한다.
2. `web-push` 도구로 VAPID 키 한 쌍을 만들어 안전하게 보관한다. Edge Function Secrets에 `EVENT_PUSH_PUBLIC_KEY`, `EVENT_PUSH_PRIVATE_KEY`, `EVENT_PUSH_SUBJECT`(운영 연락처를 `mailto:` 형식으로), `EVENT_REMINDERS_CRON_SECRET`(충분히 긴 무작위 문자열)을 설정한다.
3. 같은 예약 호출 문자열을 Vault의 `event_reminders_cron_secret`으로 저장하고, 프로젝트 URL을 `event_reminders_project_url`로 저장한다. 두 값이 있으면 Cron이 함수를 호출한다.
4. `event-reminders` Edge Function을 `supabase/config.toml`에 맞춰 배포한다. 출시할 때 앱에 알림 화면과 서비스 워커를 다시 연결하고, Edge Function Secrets에서 `EVENT_REMINDERS_ENABLED=true`를 설정한 뒤 Cron 작업을 활성화한다. 공개 GET은 VAPID 공개 키를 반환하고, 예약 발송 POST는 전용 호출 비밀값을 확인한다.
5. 새 앱을 올린 뒤 실제 기기를 등록하고, 시작 10분 전에 알림이 오도록 15분 이상 뒤의 중요 일정을 하나 만들어 확인한다. 알림을 눌러 날짜가 맞는지 본다.

Cron은 발송 예정 시각부터 10분 사이에 다시 시도하며 일정 시작 시각 이후에는 발송하지 않는다. VAPID 키를 바꾸면 설정 → 일정 알림에서 기기 알림을 끈 뒤 다시 켜야 한다.
