# 운영 배포

운영 주소는 https://self-fit.choies.kr 이에요. Cloudflare 프록시 뒤의 EC2 한 대(Amazon Linux 2023)에서 Caddy → Express(4000) → PostgreSQL 15가 돌아가요. `https://3.38.183.142`로 들어오면 도메인으로 넘겨요.

## 자동 배포(CD)

`main`에 push하면 [.github/workflows/deploy.yml](../.github/workflows/deploy.yml)이 실행돼요.

1. **테스트·빌드**: 일회용 PostgreSQL 15 서비스 컨테이너로 `npm test`(통합 테스트 포함)와 `npm run build`를 돌려요. 실패하면 배포하지 않아요.
2. **운영 서버 배포**: `git archive`로 만든 소스 tar를 배포 전용 SSH 키로 서버에 보내요. 이 키는 서버의 [`self-fit-deploy`](server/self-fit-deploy) 명령만 실행할 수 있어요.
3. 서버 스크립트가 순서대로 처리해요.
   - 새 릴리스 폴더에 소스를 풀고 `npm ci` → Prisma Client 생성 → 프런트엔드 빌드
   - `pg_dump`로 DB 백업(`/var/lib/self-fit/backups/predeploy-*.dump`, 최근 10개 보관)
   - `prisma migrate deploy`. 실패하면 여기서 멈추고 기존 버전이 계속 돌아요.
   - `/opt/self-fit/app` 링크를 새 릴리스로 바꾸고 API 재시작
   - `/api/health`가 40초 안에 정상이 아니면 이전 릴리스로 되돌려요(마이그레이션은 되돌리지 않아요).
   - 정적 파일을 `/srv/self-fit/www`에 게시하고 오래된 릴리스를 정리(최근 3개 + 직전 릴리스 보관)
4. 마지막으로 공개 주소의 `/api/health`를 확인해요.

동시에 두 번 push해도 배포는 하나씩 진행돼요(`concurrency`와 서버 잠금). Actions 화면의 **Run workflow**로 `main`을 다시 배포할 수도 있어요.

## 처음 한 번 하는 설정

서버 쪽은 2026-10-27에 설정을 마쳤어요. 새 서버를 만들면 아래를 다시 해요.

**GitHub 시크릿** — 저장소 Settings → Secrets and variables → Actions에 `DEPLOY_SSH_KEY`로 배포 전용 개인키(ed25519) 전체를 넣어요. 키를 바꾸면 서버의 `authorized_keys`도 바꿔야 해요. 서버 주소·호스트 키는 공개 정보라 워크플로 파일에 적혀 있어요.

**서버**

```sh
# 배포 스크립트(root 소유)
sudo install -m 0755 -o root -g root deploy/server/self-fit-deploy /usr/local/sbin/self-fit-deploy

# 배포 사용자: 비밀번호 잠금, 키로는 배포 스크립트만 실행
sudo useradd --create-home --shell /bin/bash selffit-deploy
sudo install -d -o selffit-deploy -g selffit-deploy -m 0700 /home/selffit-deploy/.ssh
# /home/selffit-deploy/.ssh/authorized_keys (0600) 한 줄:
# restrict,command="sudo -n /usr/local/sbin/self-fit-deploy \"${SSH_ORIGINAL_COMMAND:-}\"" ssh-ed25519 AAAA... self-fit-github-actions-deploy

# /etc/sudoers.d/self-fit-deploy (0440)
# Defaults:selffit-deploy !requiretty, !use_pty
# selffit-deploy ALL=(root) NOPASSWD: /usr/local/sbin/self-fit-deploy
```

Caddy·systemd 설정은 [server/](server/)의 파일과 같아요(`/etc/caddy/Caddyfile`, `/etc/systemd/system/self-fit.service`, `/etc/systemd/system/caddy.service`).

## 서버 파일 위치

| 경로 | 내용 |
| --- | --- |
| `/opt/self-fit/app` | 현재 릴리스로 가는 링크. 실행 중인 커밋은 `.deployed-commit` |
| `/opt/self-fit/releases/<시각>-<커밋>` | 릴리스 폴더(소유자 `selffit`) |
| `/opt/self-fit/shared/backend.env` | 운영 환경 변수. 각 릴리스의 `backend/.env`가 이 파일을 가리켜요 |
| `/var/lib/self-fit/attachments` | 첨부 파일(`STORAGE_DIR`) |
| `/var/lib/self-fit/backups` | 최초 복원 백업과 배포 전 DB 백업 |
| `/srv/self-fit/www` | Caddy가 내보내는 프런트엔드 정적 파일 |
| `/usr/local/sbin/self-fit-deploy` | 배포 스크립트 |

서버의 `/tmp`는 1.9GB 메모리 파일시스템이에요. 큰 빌드·다운로드는 `/var/tmp`에서 해요.

## 수동 배포

Actions 없이 같은 방식으로 배포할 수 있어요(배포 키 필요).

```sh
git archive --format=tar <커밋> | ssh -i <배포 키> selffit-deploy@3.38.183.142 <40자리 커밋 SHA>
```

## 되돌리기

이전 코드로 돌아가려면 되돌린 커밋을 `main`에 push하는 것이 가장 안전해요. 급할 때는 서버에서 직접 바꿔요.

```sh
sudo ls /opt/self-fit/releases
sudo ln -sfn /opt/self-fit/releases/<이전 릴리스> /opt/self-fit/app
sudo systemctl restart self-fit
sudo rsync -a --delete --chown=root:root --chmod=D755,F644 /opt/self-fit/app/frontend/dist/ /srv/self-fit/www/
```

DB는 자동으로 되돌리지 않아요. 마이그레이션을 되돌려야 하면 앱을 멈추고 해당 `predeploy-*.dump`를 새 DB에 복원해 확인한 뒤 전환해요.

## 배포 스크립트·서버 설정을 바꿀 때

`deploy/server/`의 파일을 고쳐도 서버에는 자동으로 반영되지 않아요. 배포 키가 root 권한으로 실행되는 스크립트 자체를 바꾸지 못하게 하려는 의도예요. 고친 뒤 위 설치 명령으로 서버에 직접 넣어요. Cloudflare가 프록시 IP 대역을 바꾸면 `Caddyfile`의 `trusted_proxies`도 갱신해요.
