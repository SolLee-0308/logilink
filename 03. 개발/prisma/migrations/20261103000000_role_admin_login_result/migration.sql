-- 3PL 관리자 역할 + 로그인 이력 결과 코드
-- 새 enum 값은 같은 트랜잭션에서 쓸 수 없으므로(체크 제약 등) 별도 마이그레이션으로 먼저 추가한다.

ALTER TYPE "UserRole" ADD VALUE 'TPL_ADMIN' BEFORE 'TPL_OPERATOR';

CREATE TYPE "LoginResult" AS ENUM ('SUCCESS', 'FAIL', 'LOCKED', 'BLOCKED_INACTIVE', 'BLOCKED_PDA');
